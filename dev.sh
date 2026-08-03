#!/usr/bin/env bash
# Запуск тестового окружения ReqTrace на дев-машине («полигон») одной командой:
#
#   ./dev.sh            # из корня клона
#
# Что делает (и в каком порядке):
#   1. Проверяет окружение: docker запущен, reqtrace/.env есть и без прод-роли
#      (COMPOSE_PROFILES=prod на полигоне попросил бы 80/443 и серты).
#   2. Подсказывает, если origin/main ушёл вперёд (релизы выходят и с офисного
#      Мака) — подсказка, не гард: работать это не мешает.
#   3. Поднимает docker-набор полигона (postgres + backend) с пересборкой —
#      бэкенд запечён в образ, пересборка подхватывает локальные правки.
#   4. Ждёт, пока бэкенд ответит на /api/health (миграции применяются на
#      старте), и запускает фронтенд дев-сервером (npm start, hot reload).
#
# Терминал остаётся у фронтенда; Ctrl+C останавливает только его — docker-часть
# продолжает работать (остановить: docker compose down из каталога reqtrace/).
# Прод-обновление на офисном Маке — соседний update.sh.
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
[ -f reqtrace/docker-compose.yml ] \
  || fail "Рядом со скриптом нет reqtrace/docker-compose.yml — запускайте из корня клона."

# docker compose v2 или классический docker-compose — что есть, тем и работаем.
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose --project-directory "$SCRIPT_DIR/reqtrace" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { (cd "$SCRIPT_DIR/reqtrace" && docker-compose "$@"); }
else
  fail "Не найден ни «docker compose», ни «docker-compose». Docker Desktop запущен?"
fi

say "1/4 Проверяю окружение"
docker info >/dev/null 2>&1 || fail "Docker не отвечает — запустите Docker Desktop и повторите."
[ -f reqtrace/.env ] || fail "Нет reqtrace/.env — создайте по образцу: cp reqtrace/.env.example reqtrace/.env"
if grep -Eq '^COMPOSE_PROFILES=.*prod' reqtrace/.env; then
  fail "В reqtrace/.env стоит COMPOSE_PROFILES=prod — это прод-роль (фронт на 80/443 с сертами). На полигоне уберите строку."
fi
command -v npm >/dev/null 2>&1 || fail "Не найден npm — фронтенд полигона запускается дев-сервером CRA."
note "docker работает, .env на месте, роль — полигон"

# Урок v1.7.5: локальный main может отставать — релизы выходят и с офисного
# Мака. Сеть недоступна — молча пропускаем, это только подсказка.
if git fetch origin main --quiet 2>/dev/null; then
  behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
  if [ "${behind}" != "0" ]; then
    note "⚠ origin/main впереди на ${behind} коммит(ов) — перед новой веткой подтяните изменения."
  fi
fi

say "2/4 Поднимаю postgres + backend (с пересборкой)"
compose up -d --build

say "3/4 Жду, пока бэкенд поднимется"
i=0
until curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 60 ] || fail "Бэкенд не ответил за 2 минуты. Логи: docker compose logs backend --tail 50 (из каталога reqtrace/)"
  sleep 2
done
note "бэкенд отвечает на /api/health"

say "4/4 Запускаю фронтенд — http://localhost:3000 (Ctrl+C останавливает только его)"
cd reqtrace/frontend
if [ ! -d node_modules ]; then
  note "node_modules нет — первый запуск, ставлю зависимости (npm install)"
  npm install
fi
exec npm start
