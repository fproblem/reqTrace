# CLAUDE.md

Гайд для Claude Code по этому репозиторию. Прочитан автоматически в начале сессии.

## Что это за проект

**reqtrace** — инструмент отслеживания покрытия требований: тянет страницы из
Confluence, хранит их снимки, считает диффы относительно baseline и позволяет
выделять (highlight) фрагменты текста и связывать их с тестами.

- **Бэкенд** — FastAPI (Python, async SQLAlchemy + Alembic), каталог `reqtrace/backend/app`.
- **Фронтенд** — React + TypeScript (Create React App, react-router), каталог `reqtrace/frontend/src`.
- Весь код приложения — в `reqtrace/`. В корне — спецификации (`*.md`) и инструменты.

## 🧭 Сначала сориентируйся по графу кода (CodeGraph)

Проект проиндексирован [CodeGraph](https://github.com/colbymchenry/codegraph)
(каталог `.codegraph/`, индекс синхронизируется автоматически). Перед анализом,
планированием фичи или багфиксом спрашивай граф — это заменяет grep/чтение
десятков файлов одним запросом.

- **MCP-инструмент** `codegraph_explore` (подключён в Claude Code) — отвечает на
  вопросы об архитектуре и потоках одним вызовом: исходники нужных символов,
  пути вызовов между ними, blast radius.
- **CLI** — то же самое из шелла:

```bash
codegraph explore "как размещаются подсветки"   # обзор области + исходники
codegraph node PageDetailPage                    # один символ: код + вызывающие
codegraph callers get_db                         # кто вызывает
codegraph impact diff_engine --depth 2           # что заденет правка
codegraph status                                 # состояние индекса
```

Если индекс не построен (нет `.codegraph/`) — `codegraph init` в корне репо.

## Архитектура (кратко; актуальное — спрашивай CodeGraph)

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
Перепроверить: `codegraph callers <символ>` — «No callers found» подтверждает.

## Запуск и разработка

```bash
# Весь стек (postgres + backend + frontend)
cd reqtrace && docker-compose up

# Только бэкенд (нужна БД; миграции — alembic)
cd reqtrace/backend && alembic upgrade head && uvicorn app.main:app --reload

# Только фронтенд
cd reqtrace/frontend && npm install && npm start   # сборка: npm run build, тесты: npm test
```

## Тесты логики подсветки (highlight)

Размещение подсветок — самая хрупкая часть проекта: логика решает, **где** показать
привязку и **когда** считать её «Утраченной». Исторически здесь повторялись баги с
«прыгающей» подсветкой (привязка переезжала на похожий чужой текст) и неверным
переходом в «Утрачено».

Чистая логика сопоставления вынесена в
`reqtrace/frontend/src/components/PageView/highlightMatching.ts` (без DOM/React) и
покрыта юнит-тестами `highlightMatching.test.ts`.

⚠ **Обязательно прогоняй эти тесты после ЛЮБЫХ правок, затрагивающих размещение
подсветок** — `highlightMatching.ts`, `HighlightLayer.tsx`, а также логику
статусов/«Утрачено» в `pages/PageDetailPage.tsx`. Если меняешь поведение
осознанно — обнови и тесты: они фиксируют правило, что привязка показывается
только при точном совпадении текста (различия в пробелах/вёрстке и одна вставка
внутрь выделения допускаются), а правка/удаление текста → «Утрачено».

```bash
cd reqtrace/frontend
CI=true npx react-scripts test --watchAll=false src/components/PageView/highlightMatching.test.ts
# все тесты:   CI=true npm test
# типизация:   npx tsc --noEmit
```

## Конвенции

- UI и пользовательские сообщения — на русском (см. `api/client.ts`, маппинг ошибок).
- Бэкенд — async везде (`async def`, `AsyncSession`); новые эндпоинты — тоже async.
- Не коммить `backups/`. Данные `.codegraph/` сами игнорируются (внутренний `.gitignore` — его единственный файл, который стоит закоммитить).

## Версионирование и теги релизов

Версия приложения хранится в `reqtrace/frontend/public/changelog.json` — первый
объект массива — текущая версия (её читает `useCurrentVersion`).

**Changelog наполняется по ходу работы, а не перед релизом.** Блок текущей
версии в `changelog.json` создаётся вместе с релизной веткой `release/vX.Y.Z`,
и каждый `feat`/`fix`-коммит добавляет в него запись **в том же коммите** —
по-пользовательски, на русском, в стиле существующих записей (что изменилось
и зачем, без внутренних терминов). Это требование контролирует git-хук
`.githooks/commit-msg`: feat/fix-коммит в релизной ветке без застейдженного
`changelog.json` отклоняется (осознанный обход — `git commit --no-verify`,
например для правок, не видимых пользователю). После клонирования репо хук
включается один раз командой:

```bash
git config core.hooksPath .githooks
```

Перед релизом остаётся только обновить `date` блока — записи уже накоплены.

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
