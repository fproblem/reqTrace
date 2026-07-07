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
- `main.py` — точка входа, подключает роутеры. ⚠ Все роутеры, кроме `auth`,
  закрыты сессией через `include_router(dependencies=[Depends(get_current_user)])` —
  новый роутер подключай так же, иначе тест-обход маршрутов в `tests/test_auth.py` упадёт.
- `auth.py` — сессии (JWT HS256 в HttpOnly-cookie `reqtrace_session`) и зависимость `get_current_user`.
- `project_access.py` — доступ к проектам и походы в Confluence личными кредами
  (`require_page_access`, `connection_for`, `run_confluence`); `crypto.py` —
  шифрование паролей кред (Fernet, ключ `CREDENTIALS_KEY`).
- `routers/` — HTTP API: `auth, users, pages, highlights, diff, projects`.
  ⚠ `routers/pages.py` — самый крупный (~880 строк), тянет почти все модели и сервисы.
- `services/` — логика: `confluence` (интеграция с Confluence API),
  `diff_engine` (diff текста), `highlight_projection` (перенос подсветок на изменённый текст).
- `schemas/` — Pydantic-схемы запросов/ответов.
- `models/` — ORM (SQLAlchemy): `user, page, snapshot, baseline, highlight, highlight_test, project`.
- `database.py`, `config.py` — фундамент. ⚠ `database.py` импортируют ~13 модулей.

**Авторизация (v1.5.0):** вход только через Google (GIS, ID-token flow) для домена
`surf.dev` (двойная проверка: `hd`-claim + суффикс почты). Автор действия берётся
из сессии — `user_id` в телах запросов не передаётся. Конфиг — `reqtrace/.env`
(`GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `ALLOWED_EMAIL_DOMAIN`, `SESSION_TTL_DAYS`,
`COOKIE_SECURE`; образец — `.env.example`). Тесты: `backend/tests/test_auth.py`.

**Мультипроектность и личные креды (v1.5.1):** страницы живут в проектах
(`projects`); креды Confluence — личные у каждого участника
(`project_credentials`, пароль шифруется Fernet-ключом `CREDENTIALS_KEY` из
`.env`). Членство = запись кред; контент проекта виден только участникам со
статусом `ok`; 401/403 от Confluence помечает подключение `invalid` (замок в
дереве). Глобальной таблицы `settings` больше нет; Jira URL — свойство проекта;
демо-страницы — в личном демо-проекте (`is_demo`, без кред). Один Confluence
может обслуживать несколько проектов — при добавлении страницы возможен выбор
проекта (`project_id`). Тесты: `backend/tests/test_projects.py`, `test_crypto.py`.

**Фронтенд `reqtrace/frontend/src/`**:
- `pages/` — экраны (`PageDetailPage` ~1000 строк — главный хаб UI; `SettingsPage` —
  «Мои проекты»: карточки с личными кредами и живой проверкой; `LoginPage` — вход через Google).
- `auth/AuthContext.tsx` — сессия пользователя (`useAuth`): старт с `GET /api/auth/me`,
  глобальный обработчик 401 (сброс на экран входа), `login`/`logout`.
- `components/` — `Layout/PageTree`, `PageView/*` (ContentRenderer, DiffView, HighlightLayer, SidePanel), `Toast`.
- `hooks/`, `api/client.ts` (типизированный клиент API), `types/`, `styles/tokens.ts`.

## Запуск и разработка

```bash
# Один раз: секреты (без .env компоуз не стартует)
cd reqtrace && cp .env.example .env   # заполнить POSTGRES_PASSWORD, GOOGLE_CLIENT_ID, SESSION_SECRET, CREDENTIALS_KEY

# Весь стек (postgres + backend + frontend)
cd reqtrace && docker-compose up

# Только бэкенд (нужна БД; миграции — alembic)
cd reqtrace/backend && alembic upgrade head && uvicorn app.main:app --reload

# Только фронтенд
cd reqtrace/frontend && npm install && npm start   # сборка: npm run build, тесты: npm test

# Тесты бэкенда (внутри контейнера; python на хосте не нужен)
cd reqtrace && docker compose run --rm --no-deps backend python -m unittest discover tests
```

## Тесты логики подсветки (highlight)

Размещение подсветок — самая хрупкая часть проекта: логика решает, **где** показать
привязку и **когда** считать её «Утраченной». Исторически здесь повторялись баги с
«прыгающей» подсветкой (привязка переезжала на похожий чужой текст) и неверным
переходом в «Утрачено».

Хрупкая логика вынесена в тестируемые модули (`frontend/src/components/PageView/`):
- `highlightMatching.ts` — чистое сопоставление текста (без DOM/React),
  тесты `highlightMatching.test.ts`;
- `HighlightLayer.tsx` → экспорт `applyHighlightsToContainer` — полный прогон
  размещения по DOM, тесты `highlightPlacement.test.ts` (jsdom; в т.ч.
  регрессия v1.5.7: оторванный контейнер не даёт отчёта);
- `statusSync.ts` — решение о переходах в/из «Утрачено» по отчёту слоя,
  тесты `statusSync.test.ts`.

⚠ **Обязательно прогоняй эти тесты после ЛЮБЫХ правок, затрагивающих размещение
подсветок** — `highlightMatching.ts`, `HighlightLayer.tsx`, `statusSync.ts`, а
также логику статусов/«Утрачено» в `pages/PageDetailPage.tsx`. Если меняешь
поведение осознанно — обнови и тесты: они фиксируют правило, что привязка
показывается только при точном совпадении текста (различия в пробелах/вёрстке и
одна вставка внутрь выделения допускаются), а правка/удаление текста → «Утрачено».

```bash
cd reqtrace/frontend
CI=true npm test          # все фронтовые тесты (matching, placement, statusSync, baseUrl)
# точечно:    CI=true npx react-scripts test --watchAll=false src/components/PageView
# типизация:  npx tsc --noEmit
```

Серверная половина этой же логики — `backend/app/services/highlight_projection.py`
(проекция привязок при refresh и `resolve_reanchor` для «Актуализировать»).
⚠ Все функции якорей работают строго по ОБРАБОТАННОМУ HTML (`render_page_html`),
как и фронт: сырой storage-XML снимка даёт другие блоки/смещения (текст ссылок
и кода в CDATA невидим парсеру) и до v1.5.6 портил цитаты при актуализации.
Тесты: `backend/tests/test_highlight_projection.py` (команда тестов бэкенда выше).

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

У каждой версии в `changelog.json` есть поле `title` — краткое общее название
релиза («о чём был релиз»), оно показывается в модалке «История изменений»
рядом с номером версии (с v1.5.3).

**Перед пушом релиза в master:** обновить `date` блока (записи уже накоплены)
и перечитать его записи, чтобы дать/актуализировать `title` — набор изменений
к концу ветки может уже не соответствовать заголовку, придуманному в её начале.
Стиль — как у существующих: коротко, по-пользовательски, на русском
(«Мультипроектность и личные креды», «Вход через Google»).

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
