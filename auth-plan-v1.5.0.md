# План имплементации: авторизация Google OAuth (релиз v1.5.0)

План для реализации в ветке `release/v1.5.0`. Цель — закрыть доступ к ReqTrace
для всех, кроме сотрудников с почтой `@surf.dev`, через Google OAuth.

## Текущее состояние (почему это дыра)

- «Вход» — выбор имени на `LoginPage`: `POST /api/users` создаёт/возвращает
  пользователя по имени, объект хранится в `localStorage` (`reqtrace_user`),
  `user_id` передаётся в телах запросов (`addPage`, `createHighlight`, …).
- **Ни один эндпоинт бэкенда не защищён** — все данные (снимки страниц
  Confluence, привязки, настройки с учёткой Confluence) доступны анонимно
  и по прямым запросам к `:8000`, и через UI.
- nginx фронтенда уже проксирует `/api/` → `backend:8000` — с точки зрения
  браузера всё same-origin, что позволяет строить сессию на HttpOnly-cookie.

## Целевое поведение

1. Неавторизованный пользователь видит только страницу входа с кнопкой
   «Войти через Google».
2. Вход разрешён только аккаунтам домена `surf.dev` (Workspace `hd`-claim
   **и** суффикс почты — двойная проверка); остальным — понятный отказ.
3. Все `/api/*` (кроме `/api/auth/*`) отвечают 401 без валидной сессии.
4. Сессия — HttpOnly Secure cookie, живёт ~7 дней, «Выйти» гасит её.

## Этап 0 — технические пререквизиты (из списка улучшений)

Берём только то, что реально нужно фиче:

- **Секреты → `.env`** (сейчас пароль БД и учётка Confluence зашиты в
  `docker-compose.yml`; появятся `GOOGLE_CLIENT_ID`, `SESSION_SECRET` — им
  в компоузе не место). `docker-compose.yml` → `env_file`, в репо —
  `.env.example`, сам `.env` — в `.gitignore`.
- **Удалить мёртвый код фронта**: `DashboardPage`, `useHighlights`,
  `useTextSelection` — чтобы не таскать их через рефактор auth-плама
  (`LoginPage` переписывается в рамках фичи, старый flow по имени умирает).
- Каталог `reqtrace/backend/tests/` уже создан (тесты парсинга) — тесты auth
  кладём туда же, инфраструктура не нужна.

Сознательно НЕ входит (не пререквизиты, отдельный релиз): разбиение
`routers/pages.py` (auth навешивается зависимостью на роутер целиком, трогать
внутренности не нужно) и тесты `highlight_projection`/`diff_engine`.

## Этап 1 — Google Cloud (действия пользователя, я не могу)

1. В Google Cloud Console проекта: **OAuth consent screen → Internal**
   (доступно, т.к. surf.dev — Google Workspace). Это отсекает внешние
   аккаунты ещё на стороне Google.
2. Создать **OAuth Client ID** типа Web application:
   - Authorized JavaScript origins: `http://localhost:3000` + прод-домен.
   - Redirect URI не нужен (используем Google Identity Services, ID-token flow).
3. Передать мне `client_id` (не секрет, попадает в `.env` и фронт).

## Этап 2 — бэкенд

Поток: GIS-кнопка на фронте выдаёт `credential` (ID-token JWT) → бэкенд
верифицирует и ставит собственную сессионную cookie. Code-flow с client
secret не нужен — меньше движущихся частей.

- Зависимости: `google-auth` (верификация ID-token), `PyJWT` (своя сессия).
- `config.py`: `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `ALLOWED_EMAIL_DOMAIN`
  (default `surf.dev`), `SESSION_TTL_DAYS=7`, `COOKIE_SECURE` (false локально,
  true в проде — иначе cookie не поставится на http://localhost).
- Модель `User` + alembic-миграция: `email` (unique, nullable), `google_sub`
  (unique, nullable), `avatar_url`, `last_login_at`. `name` остаётся —
  авторство старых привязок не рвём.
- Новый роутер `routers/auth.py`:
  - `POST /api/auth/google` — принимает `credential`; проверка через
    `google.oauth2.id_token.verify_oauth2_token` (aud = client_id, iss, exp,
    `email_verified`); домен: `hd == ALLOWED_EMAIL_DOMAIN` **и**
    `email.endswith("@" + домен)` — у личных аккаунтов `hd` отсутствует →
    403 с русским сообщением. Апсерт пользователя по `google_sub`, cookie.
  - `GET /api/auth/me` — текущий пользователь (для старта SPA).
  - `POST /api/auth/logout` — гасит cookie.
  - Cookie: HttpOnly, SameSite=Lax, Secure по конфигу, path=/, JWT HS256
    {sub: user_id, email, exp}.
- Зависимость `get_current_user` (cookie → JWT → User, иначе 401).
  Подключить **на уровне `include_router(dependencies=[...])` в `main.py`**
  для всех роутеров, кроме `auth` — так нельзя забыть новый эндпоинт.
  Отдельно не забыть: `/api/confluence-proxy` и `/{page_id}/attachments/`
  (их дергают `<img>` — cookie same-origin уходит автоматически, работает).
- `user_id` из тел запросов удалить — источник истины только сессия
  (правка схем: `RefreshRequest`, `HighlightCreate`, `PageCreate`, …).
  `POST /api/users` (вход по имени) удалить.

## Этап 3 — фронтенд

- `LoginPage` переписать: скрипт `accounts.google.com/gsi/client`, кнопка
  Google → `api.loginWithGoogle(credential)`; при 403 — «Доступ только для
  сотрудников surf.dev»; при недоступности GIS-скрипта — внятная ошибка.
- `AuthContext` вместо `localStorage.reqtrace_user`: на старте `GET
  /api/auth/me`; 401 → рендер LoginPage. Убрать `userId`-пропсы из `Layout`,
  `PageDetailPage`, `PageTree` (беров из контекста только для отображения).
- `api/client.ts`: убрать `user_id` из тел; глобальная обработка 401
  (сессия истекла → на вход); маппинг 403-домена на русский.
- `Layout`: имя/аватар из сессии; «Выйти» → `POST /api/auth/logout`.

## Этап 4 — миграция данных

Старые пользователи (по имени) остаются историческими авторами привязок —
их записи не трогаем. Google-вход создаёт нового пользователя. Слияние
старого профиля с новым (по имени) — вручную по необходимости, в план не
входит.

## Этап 5 — тесты и проверка

- `tests/test_auth.py` (unittest, мок `verify_oauth2_token`):
  - домен: личный gmail (нет `hd`) → 403; чужой workspace → 403;
    `hd=surf.dev`, но email иного домена → 403; валидный surf.dev → 200+cookie;
  - сессия: истёкший JWT → 401, подпись чужим ключом → 401, без cookie → 401;
  - **обход всех маршрутов приложения**: для каждого route из `app.routes`
    (кроме allowlist `/api/auth/*`, `/health`, docs) — запрос без cookie
    обязан вернуть 401. Это страховка «не забыли закрыть новый эндпоинт».
- Фронт: `npx tsc --noEmit`, существующие тесты подсветки.
- Ручная e2e: вход → работа с привязками → картинки-вложения грузятся →
  выход → прямой URL без сессии → редирект на вход; заход с не-surf.dev.

## Порядок и риски

Порядок: Этап 0 → 2 → 3 → 5 (этап 1 — параллельно, нужен от пользователя
до начала этапа 3, для этапа 2 достаточно значения-заглушки в тестах).

| Риск | Решение |
|------|---------|
| Secure-cookie не ставится на http | `COOKIE_SECURE` из env, локально false |
| GIS-скрипт заблокирован/офлайн | таймаут + сообщение на LoginPage |
| Рассинхрон часов при верификации | `clock_skew_in_seconds=10` |
| Забыть защитить новый роутер | тест-обход `app.routes` (этап 5) |
| Привязки старых юзеров «осиротеют» | `name` остаётся, записи не трогаем |

## Открытые вопросы (нужно от пользователя до старта)

1. Подтвердить: surf.dev — Google Workspace, есть доступ к Cloud Console
   (для Internal consent screen), и получить `client_id` (этап 1).
2. Прод-адрес приложения (для origins и `COOKIE_SECURE=true`).
3. Нужен ли dev-байпас (`AUTH_DISABLED=1` с фиктивным пользователем) для
   локальной разработки без интернета — предлагаю да, но решаем вместе.

## Definition of Done

- [ ] Без сессии ни один `/api/*` (кроме auth) не отдаёт данных — 401.
- [ ] Вход возможен только с почтой `@surf.dev`; чужим — русское сообщение.
- [ ] Выход работает; истёкшая сессия ведёт на вход без потери UX.
- [ ] Вложения/картинки работают под сессией.
- [ ] Секреты не в git (`.env` + `.env.example`).
- [ ] Тесты этапа 5 зелёные; changelog v1.5.0 наполнен; CLAUDE.md обновлён.
