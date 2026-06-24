# CLAUDE.md

Гайд для Claude Code по этому репозиторию. Прочитан автоматически в начале сессии.

## Что это за проект

**reqtrace** — инструмент отслеживания покрытия требований: тянет страницы из
Confluence, хранит их снимки, считает диффы относительно baseline и позволяет
выделять (highlight) фрагменты текста и связывать их с тестами.

- **Бэкенд** — FastAPI (Python, async SQLAlchemy + Alembic), каталог `reqtrace/backend/app`.
- **Фронтенд** — React + TypeScript (Create React App, react-router), каталог `reqtrace/frontend/src`.
- Весь код приложения — в `reqtrace/`. В корне — спецификации (`*.md`) и инструменты.

## 🧭 Сначала сориентируйся по карте кода

Перед тем как анализировать код, планировать фичу или чинить баг — **построй и прочитай карту кода**.
Это даёт понимание структуры и связей за ~5k токенов вместо чтения десятков файлов (~63k).

```bash
# 1. Построить/обновить карту (быстро, без зависимостей — только Python 3.8+)
python3 tools/codemap/codemap.py

# 2. Прочитать общую сводку: слои, импорты, маршруты API, символы,
#    hotspots (менять осторожно) и кандидаты в мёртвый код
#    -> tools/codemap/out/repomap.md

# 3. Перед правкой конкретного файла — посмотреть его точную окрестность
#    (что импортирует, кто зависит, какой у него API-контур):
python3 tools/codemap/codemap.py --focus routers/pages.py
python3 tools/codemap/codemap.py --focus DiffView --depth 2
```

Дополнительно: `tools/codemap/out/graph.mmd` — Mermaid-диаграмма для человека,
`graph.json` — машинные данные. Подробности и ограничения — в `tools/codemap/README.md`.
Карты лежат в `out/` и не коммитятся (см. `.gitignore`) — они регенерируются командой выше.

## Архитектура (кратко; полное и актуальное — в repomap.md)

**Бэкенд `reqtrace/backend/app/`** — слои сверху вниз:
- `main.py` — точка входа, подключает роутеры.
- `routers/` — HTTP API: `users, pages, highlights, diff, settings`.
  ⚠ `routers/pages.py` — самый крупный (~670 строк), тянет почти все модели и сервисы.
- `services/` — логика: `confluence` (интеграция с Confluence API),
  `diff_engine` (diff текста), `highlight_projection` (перенос подсветок на изменённый текст).
- `schemas/` — Pydantic-схемы запросов/ответов.
- `models/` — ORM (SQLAlchemy): `user, page, snapshot, baseline, highlight, highlight_test, settings`.
- `database.py`, `config.py` — фундамент. ⚠ `database.py` импортируют ~13 модулей.

**Фронтенд `reqtrace/frontend/src/`**:
- `pages/` — экраны (`PageDetailPage` ~1000 строк — главный хаб UI).
- `components/` — `Layout/PageTree`, `PageView/*` (ContentRenderer, DiffView, HighlightLayer, SidePanel), `Toast`.
- `hooks/`, `api/client.ts` (типизированный клиент API), `types/`, `styles/tokens.ts`.

⚠ **Кандидаты в мёртвый код** (на момент написания, проверяй перед использованием):
`hooks/useHighlights`, `hooks/useTextSelection`, `pages/DashboardPage` — никем не импортируются.
Проще всего перепроверить актуальный список через `python3 tools/codemap/codemap.py`.

## Запуск и разработка

```bash
# Весь стек (postgres + backend + frontend)
cd reqtrace && docker-compose up

# Только бэкенд (нужна БД; миграции — alembic)
cd reqtrace/backend && alembic upgrade head && uvicorn app.main:app --reload

# Только фронтенд
cd reqtrace/frontend && npm install && npm start   # сборка: npm run build, тесты: npm test
```

## Конвенции

- UI и пользовательские сообщения — на русском (см. `api/client.ts`, маппинг ошибок).
- Бэкенд — async везде (`async def`, `AsyncSession`); новые эндпоинты — тоже async.
- Не коммить `tools/codemap/out/` и `backups/`.

## Версионирование и теги релизов

Версия приложения хранится в `reqtrace/frontend/public/changelog.json` — первый
объект массива — текущая версия (её читает `useCurrentVersion`).

**Правило (обязательно).** Каждый раз, когда версия повышается в `changelog.json`
и изменения пушатся в `master`, **ставь аннотированный git-тег на релизный коммит
и пушь его в `origin`**. Это точки отката — пропускать их нельзя. Если бампишь
версию и пушишь в master без тега — это ошибка, верни и поставь тег.

- Формат тега — `v.<версия>` (с точкой после `v`, как у существующих
  `v.1.2.0`, `v.1.3.0`, `v.1.3.1`, `v.1.3.2`). Версия берётся из `changelog.json`
  (например, `"1.3.2"` → тег `v.1.3.2`).
- Тег вешается на коммит с бампом changelog (релизный коммит), а не на
  последующие правки.
- Сообщение тега аннотированное: кратко описывает релиз и способ отката
  (`git reset --hard v.X.Y.Z`).

```bash
git tag -a v.1.3.2 -m "Релиз v1.3.2 — <краткое описание>" <релизный-коммит>
git push origin v.1.3.2
```
