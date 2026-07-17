#!/usr/bin/env bash
# Обновление ReqTrace на рабочей машине (офисный Mac) одной командой:
#
#   ./update.sh            # из корня клона
#   ~/reqtrace-update.sh /путь/к/клону   # если копия скрипта лежит вне репо
#
# Что делает (и в каком порядке):
#   1. Проверяет окружение: docker запущен, клон на main, рабочее дерево чистое.
#   2. Смотрит, есть ли обновления в origin/main; показывает входящие коммиты
#      и предупреждает, если релиз несёт миграции БД.
#   3. Делает бэкап БД в backups/ (поднимая postgres, если он остановлен);
#      хранит последние 10 бэкапов, старые удаляет.
#   4. git pull --ff-only и docker compose up -d --build.
#   5. Ждёт, пока бэкенд ответит на /api/health (миграции применяются на старте),
#      печатает новую версию и подчищает висячие docker-слои.
#
# При любой ошибке останавливается и печатает рецепт отката
# (git reset --hard на прежний коммит + восстановление бэкапа).
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- где репозиторий -------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${1:-$SCRIPT_DIR}"
[ -f "$REPO_DIR/reqtrace/docker-compose.yml" ] \
  || fail "В «${REPO_DIR}» нет reqtrace/docker-compose.yml. Укажите путь к клону: ./update.sh /путь/к/reqTrace"
cd "$REPO_DIR"

# docker compose v2 или классический docker-compose — что есть, тем и работаем.
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose --project-directory "$REPO_DIR/reqtrace" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { (cd "$REPO_DIR/reqtrace" && docker-compose "$@"); }
else
  fail "Не найден ни «docker compose», ни «docker-compose». Docker Desktop запущен?"
fi

main() {
  # --- 1. проверки окружения ----------------------------------------------
  say "1/5 Проверяю окружение"
  docker info >/dev/null 2>&1 || fail "Docker не отвечает — запустите Docker Desktop и повторите."
  [ -f reqtrace/.env ] || fail "Нет reqtrace/.env — без секретов стек не поднимется."

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" = "main" ] || fail "Клон стоит на ветке «${branch}», обновления приезжают в main. Выполните: git checkout main"
  [ -z "$(git status --porcelain)" ] \
    || fail "В рабочем дереве есть локальные изменения — обновление их затронет. Посмотрите: git status"
  note "docker работает, ветка main, дерево чистое"

  # --- 2. что приехало -----------------------------------------------------
  say "2/5 Проверяю обновления в origin/main"
  git fetch origin main --tags --quiet
  local old_commit
  old_commit="$(git rev-parse --short HEAD)"
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    note "Уже актуальная версия ($(current_version)) — обновлять нечего."
    exit 0
  fi
  git log --oneline HEAD..origin/main | sed 's/^/   /'

  local migrations
  migrations="$(git diff --name-only HEAD origin/main -- reqtrace/backend/alembic/versions/ || true)"
  if [ -n "$migrations" ]; then
    note "⚠ Релиз несёт миграции БД (применятся сами при старте бэкенда):"
    printf '%s\n' "$migrations" | sed 's/^/     /'
  fi

  # --- 3. бэкап БД ----------------------------------------------------------
  say "3/5 Бэкап базы данных"
  compose up -d postgres >/dev/null 2>&1
  local i=0
  until compose exec -T postgres pg_isready -U reqtrace >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -le 30 ] || fail "postgres не поднялся за 60 секунд — бэкап невозможен, обновление остановлено."
    sleep 2
  done
  mkdir -p backups
  BACKUP="backups/pre-update-$(date +%Y-%m-%d-%H%M%S).sql.gz"
  compose exec -T postgres pg_dump -U reqtrace -d reqtrace --clean --if-exists | gzip > "$BACKUP"
  [ -s "$BACKUP" ] || fail "Бэкап получился пустым ($BACKUP) — обновление остановлено."
  note "сохранён $BACKUP ($(du -h "$BACKUP" | cut -f1 | tr -d ' '))"
  # Храним последние 10 pre-update-бэкапов, старые удаляем.
  ls -t backups/pre-update-*.sql.gz 2>/dev/null | tail -n +11 | while read -r f; do rm -f "$f"; done

  # Дальше любая ошибка печатает рецепт отката.
  trap 'rollback_hint "$old_commit"' ERR

  # --- 4. обновление и пересборка -------------------------------------------
  say "4/5 Обновляю код и пересобираю контейнеры"
  git pull --ff-only origin main --quiet
  note "код обновлён: $old_commit → $(git rev-parse --short HEAD)"
  compose up -d --build

  # --- 5. проверка живости ---------------------------------------------------
  say "5/5 Жду, пока приложение поднимется"
  i=0
  until curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -le 60 ] || { false; }   # false → сработает trap с рецептом отката
    sleep 2
  done
  note "бэкенд отвечает на /api/health"
  curl -fsS -o /dev/null http://localhost:3000/ && note "фронтенд отвечает на :3000" \
    || note "⚠ фронтенд на :3000 пока не ответил — дайте ему полминуты и откройте в браузере"

  trap - ERR
  docker image prune -f >/dev/null 2>&1 || true

  say "✓ ReqTrace обновлён до v$(current_version)"
  note "Откат при необходимости: git reset --hard $old_commit && $(compose_name) up -d --build"
  note "Бэкап БД перед обновлением: $BACKUP"
}

current_version() {
  sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' reqtrace/frontend/public/changelog.json | head -1
}

compose_name() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"; else echo "docker-compose"; fi
}

rollback_hint() {
  printf '\n\033[31m✗ Обновление не удалось.\033[0m Рецепт отката:\n' >&2
  printf '   1. Логи бэкенда:      %s logs backend --tail 50   (из каталога reqtrace/)\n' "$(compose_name)" >&2
  printf '   2. Вернуть код:       git reset --hard %s\n' "$1" >&2
  printf '   3. Пересобрать:       %s up -d --build            (из каталога reqtrace/)\n' "$(compose_name)" >&2
  printf '   4. Если релиз нёс миграции — восстановить БД:\n' >&2
  printf '      %s stop backend && gunzip -c %s | %s exec -T postgres psql -U reqtrace -d reqtrace && %s start backend\n' \
    "$(compose_name)" "${BACKUP:-backups/pre-update-…sql.gz}" "$(compose_name)" "$(compose_name)" >&2
  exit 1
}

main
