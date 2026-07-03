"""Тесты авторизации Google OAuth (v1.5.0).

Три группы (см. auth-plan-v1.5.0.md, этап 5):

1. Доменная политика POST /api/auth/google (verify_oauth2_token замокан):
   личный gmail (нет hd), чужой workspace, hd=surf.dev с почтой иного домена,
   неподтверждённая почта → 403; валидный surf.dev → 200 + Set-Cookie;
   невалидный ID-token → 401.
2. Сессионная cookie: без cookie, мусор вместо JWT, истёкший JWT, подпись
   чужим ключом, валидный JWT несуществующего пользователя → 401;
   валидный JWT → 200 на /api/auth/me.
3. Обход ВСЕХ маршрутов приложения: любой /api/* вне allowlist без cookie
   обязан вернуть 401 — страховка «не забыли закрыть новый эндпоинт».

БД не нужна: get_db подменяется FakeSession (запросы к БД в 401/403-путях
не выполняются, а для успешного входа сессия эмулируется).

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import re
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt
from fastapi.testclient import TestClient

from app.auth import JWT_ALGORITHM, SESSION_COOKIE_NAME, get_current_user  # noqa: F401
from app.config import settings
from app.database import get_db
from app.main import app
from app.models.user import User

TEST_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
TEST_SECRET = "test-session-secret"


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeSession:
    """Минимум интерфейса AsyncSession, который используют auth-эндпоинты."""

    def __init__(self, execute_results=None, users_by_id=None):
        self.execute_results = list(execute_results or [])
        self.users_by_id = users_by_id or {}
        self.added = []

    async def execute(self, stmt):
        return FakeResult(self.execute_results.pop(0) if self.execute_results else None)

    async def get(self, model, pk):
        return self.users_by_id.get(pk)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def refresh(self, obj, attrs=None):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()


class AuthTestBase(unittest.TestCase):
    fake_session: FakeSession

    def setUp(self):
        settings.GOOGLE_CLIENT_ID = TEST_CLIENT_ID
        settings.SESSION_SECRET = TEST_SECRET
        settings.ALLOWED_EMAIL_DOMAIN = "surf.dev"
        self.fake_session = FakeSession()
        app.dependency_overrides[get_db] = lambda: self.fake_session
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def session_cookie(self, user_id=None, exp_delta=timedelta(days=1), secret=TEST_SECRET):
        payload = {
            "sub": str(user_id or uuid.uuid4()),
            "email": "qa@surf.dev",
            "exp": datetime.now(timezone.utc) + exp_delta,
        }
        return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def google_idinfo(**overrides):
    idinfo = {
        "sub": "google-sub-123",
        "email": "qa@surf.dev",
        "email_verified": True,
        "hd": "surf.dev",
        "name": "QA Surf",
        "picture": "https://lh3.googleusercontent.com/a/photo",
    }
    idinfo.update(overrides)
    return {k: v for k, v in idinfo.items() if v is not None}


class TestGoogleLoginDomainPolicy(AuthTestBase):
    def login(self, idinfo):
        with patch("app.routers.auth.id_token.verify_oauth2_token", return_value=idinfo):
            return self.client.post("/api/auth/google", json={"credential": "stub"})

    def test_personal_gmail_without_hd_rejected(self):
        resp = self.login(google_idinfo(hd=None, email="someone@gmail.com"))
        self.assertEqual(resp.status_code, 403)
        self.assertIn("surf.dev", resp.json()["detail"])

    def test_foreign_workspace_rejected(self):
        resp = self.login(google_idinfo(hd="other.com", email="user@other.com"))
        self.assertEqual(resp.status_code, 403)

    def test_hd_ok_but_email_of_other_domain_rejected(self):
        resp = self.login(google_idinfo(email="user@gmail.com"))
        self.assertEqual(resp.status_code, 403)

    def test_unverified_email_rejected(self):
        resp = self.login(google_idinfo(email_verified=False))
        self.assertEqual(resp.status_code, 403)

    def test_invalid_credential_rejected(self):
        with patch(
            "app.routers.auth.id_token.verify_oauth2_token",
            side_effect=ValueError("Token expired"),
        ):
            resp = self.client.post("/api/auth/google", json={"credential": "garbage"})
        self.assertEqual(resp.status_code, 401)

    def test_valid_surf_dev_login_sets_cookie(self):
        # Два запроса к БД: поиск по google_sub и проверка занятости имени.
        self.fake_session.execute_results = [None, None]
        resp = self.login(google_idinfo())

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["email"], "qa@surf.dev")
        self.assertEqual(body["name"], "QA Surf")

        set_cookie = resp.headers.get("set-cookie", "")
        self.assertIn(f"{SESSION_COOKIE_NAME}=", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("Path=/", set_cookie)
        self.assertIn("samesite=lax", set_cookie.lower())

        self.assertEqual(len(self.fake_session.added), 1)
        created = self.fake_session.added[0]
        self.assertEqual(created.google_sub, "google-sub-123")
        self.assertEqual(created.email, "qa@surf.dev")

    def test_name_collision_falls_back_to_email(self):
        existing = User(name="QA Surf")
        # Поиск по google_sub — пусто, имя занято историческим пользователем.
        self.fake_session.execute_results = [None, existing]
        resp = self.login(google_idinfo())

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "qa@surf.dev")


class TestSessionCookie(AuthTestBase):
    def test_no_cookie_401(self):
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 401)

    def test_garbage_cookie_401(self):
        self.client.cookies.set(SESSION_COOKIE_NAME, "not-a-jwt")
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 401)

    def test_expired_jwt_401(self):
        self.client.cookies.set(SESSION_COOKIE_NAME, self.session_cookie(exp_delta=timedelta(days=-1)))
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 401)

    def test_wrong_signature_401(self):
        self.client.cookies.set(SESSION_COOKIE_NAME, self.session_cookie(secret="attacker-secret"))
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 401)

    def test_valid_jwt_unknown_user_401(self):
        self.client.cookies.set(SESSION_COOKIE_NAME, self.session_cookie(user_id=uuid.uuid4()))
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 401)

    def test_valid_session_returns_user(self):
        user = User(name="QA Surf", email="qa@surf.dev")
        user.id = uuid.uuid4()
        self.fake_session.users_by_id[user.id] = user

        self.client.cookies.set(SESSION_COOKIE_NAME, self.session_cookie(user_id=user.id))
        resp = self.client.get("/api/auth/me")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["email"], "qa@surf.dev")

    def test_logout_clears_cookie(self):
        resp = self.client.post("/api/auth/logout")
        self.assertEqual(resp.status_code, 204)
        self.assertIn(f'{SESSION_COOKIE_NAME}=""', resp.headers.get("set-cookie", ""))


class TestAllRoutesRequireAuth(AuthTestBase):
    """Обход app.routes: каждый /api/* вне allowlist без cookie отдаёт 401."""

    ALLOWLIST_EXACT = {"/api/health"}
    ALLOWLIST_PREFIXES = ("/api/auth/",)

    def test_every_api_route_requires_session(self):
        checked = 0
        for route in app.routes:
            path = getattr(route, "path", "")
            methods = getattr(route, "methods", None)
            if not path.startswith("/api") or not methods:
                continue
            if path in self.ALLOWLIST_EXACT or path.startswith(self.ALLOWLIST_PREFIXES):
                continue

            url = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
            for method in methods - {"HEAD", "OPTIONS"}:
                with self.subTest(route=f"{method} {path}"):
                    resp = self.client.request(method, url)
                    self.assertEqual(
                        resp.status_code, 401,
                        f"{method} {path} доступен без сессии (код {resp.status_code}) — "
                        f"роутер не закрыт get_current_user в main.py",
                    )
                checked += 1

        # Если счётчик внезапно упал до нуля — тест «прошёл», ничего не проверив.
        self.assertGreater(checked, 15, "Обход маршрутов не нашёл /api/* эндпоинтов")


if __name__ == "__main__":
    unittest.main()
