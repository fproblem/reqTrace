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
  `diff_engine` (diff текста), `highlight_projection` (перенос подсветок на изменённый текст),
  `tree_sync` (сверка дерева со спейсами — общая для эндпоинта sync-tree и ночной джобы).
- `jobs/` — фоновые задачи (v1.6.2): `nightly` — ночной прогон автообновления
  (перепроверка кред → sync-tree → refresh страниц, журнал `refresh_runs`),
  `scheduler` — asyncio-задача в lifespan (`AUTO_REFRESH_*` в `.env`).
  Дизайн — `auto-refresh-plan-v1.6.md` в корне; тесты — `tests/test_nightly_refresh.py`.
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

## Привязки: модель «маркер в снимке» (v1.5.9)

Эталон поведения — inline-комментарии Confluence (исследование и полный дизайн:
`anchoring-plan-v1.5.9.md`). Привязка — диапазон в тексте ОБРАБОТАННОГО HTML
конкретного снимка; при каждом refresh диапазон ОДИН РАЗ переносится диффом
«старый снимок → новый» на сервере. **Фронтенд ничего не ищет и статусы не
решает** — он рендерит готовые координаты. Поиска текста по странице не
существует нигде: «прыгающая» подсветка и «самоустаревание» статусов невозможны
по построению.

Правила статусов (полная таблица — в плане; зафиксированы тестами):
- создание → «Требует проверки»; сопоставление цитаты с координатами происходит
  ровно один раз — сервер верифицирует якорь при создании;
- refresh: диапазон выжил и текст не изменился → статус сохраняется; текст
  изменился → «Требует проверки» (в панели — пословный дифф цитаты); не уцелел
  ни один символ → «Утрачено»;
- «Утрачено» ТЕРМИНАЛЬНО (решение пользователя): без восстановления и
  перепривязки — тесты привязываются заново к новой привязке;
- «Актуализировать» (только человек): цитатой становится текущий текст под
  маркером (`anchored_text`), статус «Актуально». Refresh статус не повышает.

Ключевые модули:
- бэкенд `services/anchoring.py` — документная модель, дифф, перенос диапазонов,
  статусы (тесты `tests/test_anchoring.py`); `services/page_service.py` —
  конвейер refresh (тесты `tests/test_page_service.py`); HTTP-слой —
  `tests/test_highlights_api.py`;
- фронт `PageView/selection/` — захват выделения Range → якоря (тесты
  `selectionAnchors.test.ts`); `HighlightLayer.tsx` — координатный рендер с
  валидационным гардом (тесты `highlightPlacement.test.ts`);
  `quoteDiff.ts` — дифф цитаты в панели (тесты `quoteDiff.test.ts`);
  `highlightMatching.ts` — только нормализация текста (зеркало norm_key).

⚠ **Обязательно прогоняй тесты этих модулей после ЛЮБЫХ правок в них** (обе
команды ниже). Меняешь правила осознанно — обнови план и тесты. Известные
задокументированные ограничения диффа — в шапке `anchoring.py`.

⚠ Все якоря — строго по ОБРАБОТАННОМУ HTML (`render_page_html`), как и фронт:
сырой storage-XML снимка даёт другие блоки/смещения (текст ссылок и кода в
CDATA невидим парсеру) и до v1.5.6 портил цитаты при актуализации.

```bash
cd reqtrace/frontend
CI=true npm test          # фронтовые тесты (placement, selection, quoteDiff, matching, baseUrl)
# точечно:    CI=true npx react-scripts test --watchAll=false src/components/PageView
# типизация:  npx tsc --noEmit
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
