#!/usr/bin/env bash
# Регулярный бэкап БД ReqTrace (прод-трек бэклога, v1.8.1) — для cron/launchd:
#
#   ./backup.sh                          # из корня клона
#   ~/reqtrace-backup.sh /путь/к/клону   # копия скрипта вне репо (для cron)
#
# Что делает: поднимает postgres (если остановлен), снимает pg_dump в
# backups/daily-<дата>.sql.gz и хранит последние 14 файлов; pre-update-бэкапы
# update.sh живут рядом под своим префиксом и ротацией не задеваются.
# Вывод краток — лог крона остаётся читаемым; любой провал = ненулевой код
# выхода (cron с MAILTO сообщит).
#
# Установка на прод-машине (пример — каждый день в 04:30, до утреннего
# чтения дайджеста и после ночного прогона 03:00):
#
#   crontab -e
#   30 4 * * * /path/to/clone/backup.sh >> /path/to/clone/backups/backup.log 2>&1
#
# Восстановление из бэкапа (dump со --clean пересоздаёт таблицы сам):
#
#   gunzip -c backups/daily-<дата>.sql.gz \
#     | docker compose --project-directory reqtrace exec -T postgres \
#       psql -U reqtrace -d reqtrace
#
# ⚠ Восстановление на ДРУГОЙ машине требует того же CREDENTIALS_KEY в .env —
# иначе зашифрованные креды участников не расшифруются (см. README).
set -euo pipefail

say()  { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { say "✗ $*" >&2; exit 1; }

# --- где репозиторий -------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${1:-$SCRIPT_DIR}"
[ -f "$REPO_DIR/reqtrace/docker-compose.yml" ] \
  || fail "В «${REPO_DIR}» нет reqtrace/docker-compose.yml. Укажите путь к клону: ./backup.sh /путь/к/reqTrace"
cd "$REPO_DIR"

# docker compose v2 или классический docker-compose — что есть, тем и работаем.
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose --project-directory "$REPO_DIR/reqtrace" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { (cd "$REPO_DIR/reqtrace" && docker-compose "$@"); }
else
  fail "Не найден ни «docker compose», ни «docker-compose». Docker Desktop запущен?"
fi

docker info >/dev/null 2>&1 || fail "Docker не отвечает — запустите Docker Desktop."

# --- postgres должен быть жив ----------------------------------------------
compose up -d postgres >/dev/null 2>&1
i=0
until compose exec -T postgres pg_isready -U reqtrace >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -le 30 ] || fail "postgres не поднялся за 60 секунд — бэкап не снят."
  sleep 2
done

# --- дамп + ротация ---------------------------------------------------------
mkdir -p backups
BACKUP="backups/daily-$(date +%Y-%m-%d-%H%M%S).sql.gz"
compose exec -T postgres pg_dump -U reqtrace -d reqtrace --clean --if-exists | gzip > "$BACKUP"
[ -s "$BACKUP" ] || { rm -f "$BACKUP"; fail "Бэкап получился пустым — файл удалён."; }

# Храним последние 14 ежедневных бэкапов; pre-update-* не трогаем.
ls -t backups/daily-*.sql.gz 2>/dev/null | tail -n +15 | while read -r f; do rm -f "$f"; done

say "✓ Бэкап готов: $BACKUP ($(du -h "$BACKUP" | cut -f1 | tr -d ' ')); ежедневных в ротации: $(ls backups/daily-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
