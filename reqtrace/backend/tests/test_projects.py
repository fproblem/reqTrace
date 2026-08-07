"""Тесты мультипроектности и личных кред (v1.5.1, этап 4).

Группы (см. projects-plan-v1.5.1.md):
1. Нормализация base URL (чистая функция).
2. POST /api/projects: создание требует успешной живой проверки кред
   (мок check_connection); отказ Confluence → 400 и ничего не создано;
   конфликт имени → 409; пароль в БД шифруется.
3. Креды: апсерт = присоединение (status ok); check помечает invalid при 401.
4. Скоупинг: не-участник получает 403 на страницу чужого проекта; invalid →
   403 «проверьте креды»; участник ok видит страницу; дерево не содержит
   чужих проектов, invalid → узел no_access без спейсов.
5. add_page: неоднозначный base_url без project_id → 400; ноль кандидатов → 400.
6. Демо: авто-создание личного демо-проекта; refresh демо-страницы → 400;
   удаление последней демо-страницы удаляет и опустевший демо-проект.

БД не нужна: get_db подменяется FakeSession. Обход всех маршрутов на 401 без
cookie — в test_auth.py, он накрывает и роутер projects.

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import jwt
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.auth import JWT_ALGORITHM, SESSION_COOKIE_NAME
from app.config import settings
from app.crypto import decrypt_secret, encrypt_secret
from app.database import get_db
from app.main import app
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.user import User
from app.project_access import normalize_base_url, url_belongs_to_base
from app.services.confluence import ConfluenceAuthError

TEST_SECRET = "test-session-secret"
CHECK_CONNECTION = "app.services.confluence.check_connection"


class FakeScalars:
    def __init__(self, value):
        self._value = value

    def all(self):
        if self._value is None:
            return []
        return list(self._value)


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar(self):
        return self._value

    def all(self):
        return list(self._value or [])

    def scalars(self):
        return FakeScalars(self._value)


class FakeSession:
    """Минимум интерфейса AsyncSession для роутеров projects/pages.

    execute() отдаёт результаты из очереди по порядку запросов эндпоинта;
    get() — объекты по (модель, pk); flush() эмулирует дефолты БД.
    """

    def __init__(self, execute_results=None, objects=None):
        self.execute_results = list(execute_results or [])
        self.objects = objects or {}
        self.added = []
        self.deleted = []
        self.committed = False

    async def execute(self, stmt):
        value = self.execute_results.pop(0) if self.execute_results else None
        return value if isinstance(value, FakeResult) else FakeResult(value)

    async def get(self, model, pk, options=None):
        return self.objects.get((model, pk))

    def add(self, obj):
        self.added.append(obj)
        self.objects[(type(obj), getattr(obj, "id", None))] = obj

    async def delete(self, obj):
        self.deleted.append(obj)

    async def flush(self):
        now = datetime.now(timezone.utc)
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()
                self.objects[(type(obj), obj.id)] = obj
            for attr in ("created_at", "fetched_at", "confirmed_at", "updated_at"):
                if hasattr(obj, attr) and getattr(obj, attr) is None:
                    setattr(obj, attr, now)
            if hasattr(obj, "is_virtual") and obj.is_virtual is None:
                obj.is_virtual = False

    async def commit(self):
        self.committed = True
        await self.flush()

    async def refresh(self, obj, attrs=None):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()


def make_project(name="Банк X", base_url="https://conf.bank-x.ru", is_demo=False,
                 created_by=None, jira="https://jira.bank-x.ru"):
    project = Project(
        name=name,
        confluence_base_url=base_url,
        jira_base_url=jira,
        is_demo=is_demo,
        created_by=created_by or uuid.uuid4(),
    )
    project.id = uuid.uuid4()
    project.created_at = datetime.now(timezone.utc)
    return project


def make_cred(project, user, status="ok", password="conf-pass"):
    cred = ProjectCredential(
        project_id=project.id,
        user_id=user.id,
        confluence_username="d.pechkin",
        confluence_password_enc=encrypt_secret(password),
        status=status,
    )
    cred.id = uuid.uuid4()
    return cred


def make_page(project, user, cpid="1001"):
    page = Page(
        project_id=project.id,
        confluence_page_id=cpid,
        confluence_url=f"{project.confluence_base_url}/pages/viewpage.action?pageId={cpid}",
        title="Требования",
        space_key="SPC",
        added_by=user.id,
    )
    page.id = uuid.uuid4()
    page.created_at = datetime.now(timezone.utc)
    page.is_virtual = False
    return page


class ProjectTestBase(unittest.TestCase):
    def setUp(self):
        settings.SESSION_SECRET = TEST_SECRET
        self._old_key = settings.CREDENTIALS_KEY
        settings.CREDENTIALS_KEY = Fernet.generate_key().decode()

        self.user = User(name="QA Surf", email="qa@surf.dev")
        self.user.id = uuid.uuid4()

        self.session = FakeSession(objects={(User, self.user.id): self.user})
        app.dependency_overrides[get_db] = lambda: self.session
        self.client = TestClient(app)
        self.client.cookies.set(SESSION_COOKIE_NAME, self._session_cookie())

    def tearDown(self):
        app.dependency_overrides.clear()
        settings.CREDENTIALS_KEY = self._old_key

    def _session_cookie(self):
        payload = {
            "sub": str(self.user.id),
            "email": self.user.email,
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        }
        return jwt.encode(payload, TEST_SECRET, algorithm=JWT_ALGORITHM)


class TestNormalizeBaseUrl(unittest.TestCase):
    def test_scheme_host_port_slash(self):
        self.assertEqual(normalize_base_url("HTTPS://Conf.Bank-X.ru/"), "https://conf.bank-x.ru")
        self.assertEqual(normalize_base_url("conf.bank-x.ru"), "https://conf.bank-x.ru")
        self.assertEqual(normalize_base_url("http://wiki.local:80/"), "http://wiki.local")
        self.assertEqual(normalize_base_url("https://wiki.local:8443"), "https://wiki.local:8443")
        self.assertEqual(normalize_base_url("https://host/confluence/"), "https://host/confluence")
        self.assertEqual(normalize_base_url("  "), "")

    def test_url_belongs_to_base(self):
        base = "https://conf.bank-x.ru"
        self.assertTrue(url_belongs_to_base(
            "https://CONF.bank-x.ru/pages/viewpage.action?pageId=1", base))
        self.assertFalse(url_belongs_to_base("https://other.ru/pages/1", base))
        # context path не должен матчить чужой префикс
        self.assertFalse(url_belongs_to_base(
            "https://host/confluence2/pages/1", "https://host/confluence"))
        self.assertTrue(url_belongs_to_base(
            "https://host/confluence/pages/1", "https://host/confluence"))
        self.assertFalse(url_belongs_to_base("https://host/pages/1", ""))


class TestCreateProject(ProjectTestBase):
    PAYLOAD = {
        "name": "Банк X",
        "confluence_base_url": "HTTPS://Conf.Bank-X.ru/",
        "jira_base_url": "https://jira.bank-x.ru/",
        "confluence_username": "d.pechkin",
        "confluence_password": "conf-pass",
    }

    def test_create_requires_live_check_and_encrypts_password(self):
        self.session.execute_results = [None]  # конфликт имени — нет
        with patch(CHECK_CONNECTION, new=AsyncMock(return_value=None)) as check:
            resp = self.client.post("/api/projects", json=self.PAYLOAD)

        self.assertEqual(resp.status_code, 201, resp.text)
        check.assert_awaited_once()
        conn = check.await_args.args[0]
        self.assertEqual(conn.base_url, "https://conf.bank-x.ru")  # нормализован
        self.assertEqual(conn.username, "d.pechkin")

        project = next(o for o in self.session.added if isinstance(o, Project))
        cred = next(o for o in self.session.added if isinstance(o, ProjectCredential))
        self.assertEqual(project.confluence_base_url, "https://conf.bank-x.ru")
        self.assertEqual(project.jira_base_url, "https://jira.bank-x.ru")
        self.assertEqual(cred.status, "ok")
        self.assertNotIn("conf-pass", cred.confluence_password_enc)
        self.assertEqual(decrypt_secret(cred.confluence_password_enc), "conf-pass")

        body = resp.json()
        self.assertTrue(body["joined"])
        self.assertEqual(body["my_status"], "ok")

    def test_create_rejected_by_confluence_creates_nothing(self):
        self.session.execute_results = [None]
        with patch(CHECK_CONNECTION, new=AsyncMock(side_effect=ConfluenceAuthError(401))):
            resp = self.client.post("/api/projects", json=self.PAYLOAD)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("отклонил логин/пароль", resp.json()["detail"])
        self.assertEqual(self.session.added, [])

    def test_create_name_conflict_409(self):
        self.session.execute_results = [make_project(name="банк x")]
        with patch(CHECK_CONNECTION, new=AsyncMock(return_value=None)):
            resp = self.client.post("/api/projects", json=self.PAYLOAD)

        self.assertEqual(resp.status_code, 409)
        self.assertIn("присоединиться", resp.json()["detail"])
        self.assertEqual(self.session.added, [])

    def test_create_duplicate_confluence_url_409(self):
        """Дубль по нормализованному URL (регистр/слэш не спасают) → 409,
        ничего не создано, до живой проверки кред дело не доходит."""
        other = make_project(name="Другой проект", base_url="https://conf.bank-x.ru")
        self.session.execute_results = [None, other]  # имя свободно, URL занят
        with patch(CHECK_CONNECTION, new=AsyncMock(return_value=None)) as check:
            resp = self.client.post("/api/projects", json=self.PAYLOAD)

        self.assertEqual(resp.status_code, 409)
        self.assertIn("уже подключён", resp.json()["detail"])
        self.assertIn("Другой проект", resp.json()["detail"])
        check.assert_not_awaited()
        self.assertEqual(self.session.added, [])


class TestCredentials(ProjectTestBase):
    def test_upsert_joins_project_with_ok_status(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [None]  # моих кред ещё нет

        with patch(CHECK_CONNECTION, new=AsyncMock(return_value=None)):
            resp = self.client.put(
                f"/api/projects/{project.id}/credentials",
                json={"confluence_username": "d.pechkin", "confluence_password": "pw"},
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        cred = next(o for o in self.session.added if isinstance(o, ProjectCredential))
        self.assertEqual(cred.status, "ok")
        self.assertEqual(cred.user_id, self.user.id)
        self.assertEqual(decrypt_secret(cred.confluence_password_enc), "pw")
        self.assertTrue(resp.json()["joined"])

    def test_upsert_with_failing_check_saves_nothing(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [None]

        with patch(CHECK_CONNECTION, new=AsyncMock(side_effect=ConfluenceAuthError(401))):
            resp = self.client.put(
                f"/api/projects/{project.id}/credentials",
                json={"confluence_username": "d.pechkin", "confluence_password": "bad"},
            )

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.session.added, [])

    def test_check_marks_invalid_on_401(self):
        project = make_project()
        cred = make_cred(project, self.user, status="ok")
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [cred]

        with patch(CHECK_CONNECTION, new=AsyncMock(side_effect=ConfluenceAuthError(401))):
            resp = self.client.post(f"/api/projects/{project.id}/credentials/check")

        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["status"], "invalid")
        self.assertEqual(cred.status, "invalid")
        self.assertIsNotNone(cred.last_check_at)

    def test_check_restores_ok(self):
        project = make_project()
        cred = make_cred(project, self.user, status="invalid")
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [cred]

        with patch(CHECK_CONNECTION, new=AsyncMock(return_value=None)):
            resp = self.client.post(f"/api/projects/{project.id}/credentials/check")

        self.assertEqual(resp.json()["status"], "ok")
        self.assertEqual(cred.status, "ok")
        self.assertEqual(cred.last_check_result, "ok")

    def test_check_unreachable_records_attempt_without_touching_status(self):
        """Confluence недоступен (VPN, сеть): 502, статус ok не сбит, но след
        попытки (unreachable + время) сохранён и закоммичен до отката."""
        project = make_project()
        cred = make_cred(project, self.user, status="ok")
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [cred]

        with patch(CHECK_CONNECTION, new=AsyncMock(side_effect=RuntimeError("connect timeout"))):
            resp = self.client.post(f"/api/projects/{project.id}/credentials/check")

        self.assertEqual(resp.status_code, 502)
        self.assertEqual(cred.status, "ok")
        self.assertEqual(cred.last_check_result, "unreachable")
        self.assertIsNotNone(cred.last_check_at)
        self.assertTrue(self.session.committed)

    def test_disconnect_deletes_my_credential(self):
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [cred]

        resp = self.client.delete(f"/api/projects/{project.id}/credentials")

        self.assertEqual(resp.status_code, 204)
        self.assertIn(cred, self.session.deleted)

    def test_delete_project_by_member(self):
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        # get_my_credential + 5 bulk-delete запросов (тесты, привязки,
        # baseline'ы, снимки, страницы)
        self.session.execute_results = [cred, None, None, None, None, None]

        resp = self.client.delete(f"/api/projects/{project.id}")

        self.assertEqual(resp.status_code, 204)
        self.assertIn(project, self.session.deleted)

    def test_delete_project_requires_membership(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [None]

        resp = self.client.delete(f"/api/projects/{project.id}")

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.session.deleted, [])


class TestPageScoping(ProjectTestBase):
    def setUp(self):
        super().setUp()
        self.project = make_project()
        self.page = make_page(self.project, self.user)
        self.session.objects[(Project, self.project.id)] = self.project
        self.session.objects[(Page, self.page.id)] = self.page

    def test_non_member_gets_403(self):
        self.session.execute_results = [None]  # моих кред нет
        resp = self.client.get(f"/api/pages/{self.page.id}")
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Подключитесь", resp.json()["detail"])

    def test_invalid_creds_get_403(self):
        self.session.execute_results = [make_cred(self.project, self.user, status="invalid")]
        resp = self.client.get(f"/api/pages/{self.page.id}")
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Проверьте креды", resp.json()["detail"])

    def test_member_ok_sees_page(self):
        self.session.execute_results = [
            make_cred(self.project, self.user, status="ok"),
            None,  # снимков нет
            None,  # baseline нет
        ]
        resp = self.client.get(f"/api/pages/{self.page.id}")
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["project_name"], "Банк X")
        self.assertEqual(body["jira_base_url"], "https://jira.bank-x.ru")

    def test_diff_of_foreign_page_403(self):
        self.session.execute_results = [None]
        resp = self.client.get(f"/api/pages/{self.page.id}/diff")
        self.assertEqual(resp.status_code, 403)

    def test_highlights_of_foreign_page_403(self):
        self.session.execute_results = [None]
        resp = self.client.get(f"/api/pages/{self.page.id}/highlights")
        self.assertEqual(resp.status_code, 403)


class TestTree(ProjectTestBase):
    def test_tree_scopes_projects_and_locks_invalid(self):
        project_ok = make_project(name="Банк X")
        project_bad = make_project(name="Ритейл Y", base_url="https://wiki.retail-y.com")
        cred_ok = make_cred(project_ok, self.user, status="ok")
        cred_bad = make_cred(project_bad, self.user, status="invalid")
        page = make_page(project_ok, self.user)

        self.session.execute_results = [
            FakeResult([(project_ok, cred_ok), (project_bad, cred_bad)]),  # членства
            FakeResult([]),      # демо-проектов нет
            FakeResult([page]),  # страницы доступных проектов
            FakeResult([]),      # счётчики привязок
        ]

        resp = self.client.get("/api/pages/tree")
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(len(body), 2)

        by_name = {item["project_name"]: item for item in body}
        ok_node = by_name["Банк X"]
        bad_node = by_name["Ритейл Y"]
        self.assertFalse(ok_node["no_access"])
        self.assertEqual(len(ok_node["spaces"]), 1)
        self.assertEqual(ok_node["spaces"][0]["space_key"], "SPC")
        self.assertTrue(bad_node["no_access"])
        self.assertEqual(bad_node["spaces"], [])  # спейсы закрытого проекта не отдаются


class TestAddPage(ProjectTestBase):
    def test_ambiguous_base_url_without_project_id_400(self):
        shared = "https://conf.shared.ru"
        p1 = make_project(name="Проект 1", base_url=shared)
        p2 = make_project(name="Проект 2", base_url=shared)
        self.session.execute_results = [
            FakeResult([
                (p1, make_cred(p1, self.user)),
                (p2, make_cred(p2, self.user)),
            ]),
        ]

        resp = self.client.post("/api/pages", json={
            "confluence_url": f"{shared}/pages/viewpage.action?pageId=100",
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn("нескольким проектам", resp.json()["detail"])

    def test_no_matching_project_400(self):
        self.session.execute_results = [FakeResult([])]
        resp = self.client.post("/api/pages", json={
            "confluence_url": "https://unknown.ru/pages/viewpage.action?pageId=100",
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Подключите проект", resp.json()["detail"])

    def test_invalid_creds_403(self):
        project = make_project()
        self.session.execute_results = [
            FakeResult([(project, make_cred(project, self.user, status="invalid"))]),
        ]
        resp = self.client.post("/api/pages", json={
            "confluence_url": f"{project.confluence_base_url}/pages/viewpage.action?pageId=100",
        })
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Проверьте креды", resp.json()["detail"])


class TestDemoPages(ProjectTestBase):
    def test_demo_page_creates_personal_demo_project(self):
        self.session.execute_results = [None]  # демо-проекта ещё нет
        resp = self.client.post("/api/pages/demo")

        self.assertEqual(resp.status_code, 200, resp.text)
        project = next(o for o in self.session.added if isinstance(o, Project))
        self.assertTrue(project.is_demo)
        self.assertEqual(project.name, "Демо — QA Surf")
        self.assertEqual(project.created_by, self.user.id)

        page = next(o for o in self.session.added if isinstance(o, Page))
        self.assertEqual(page.project_id, project.id)
        self.assertEqual(resp.json()["project_name"], "Демо — QA Surf")

    def test_refresh_demo_page_400(self):
        demo = make_project(name="Демо — QA Surf", base_url="", is_demo=True,
                            created_by=self.user.id, jira=None)
        page = make_page(demo, self.user, cpid="demo-12345678")
        self.session.objects[(Project, demo.id)] = demo
        self.session.objects[(Page, page.id)] = page

        resp = self.client.post(f"/api/pages/{page.id}/refresh")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Демо-страница не связана с Confluence", resp.json()["detail"])

    def test_foreign_demo_project_page_404(self):
        stranger = User(name="Другой")
        stranger.id = uuid.uuid4()
        demo = make_project(name="Демо — Другой", base_url="", is_demo=True,
                            created_by=stranger.id, jira=None)
        page = make_page(demo, stranger, cpid="demo-87654321")
        self.session.objects[(Project, demo.id)] = demo
        self.session.objects[(Page, page.id)] = page

        resp = self.client.get(f"/api/pages/{page.id}")
        self.assertEqual(resp.status_code, 404)

    def _make_demo_with_page(self):
        demo = make_project(name="Демо — QA Surf", base_url="", is_demo=True,
                            created_by=self.user.id, jira=None)
        page = make_page(demo, self.user, cpid="demo-12345678")
        page.space_key = "DEMO"
        self.session.objects[(Project, demo.id)] = demo
        self.session.objects[(Page, page.id)] = page
        return demo, page

    def test_delete_last_demo_page_removes_demo_project(self):
        demo, page = self._make_demo_with_page()
        self.session.execute_results = [
            None,           # delete HighlightTest
            None,           # delete Highlight
            None,           # delete Baseline
            None,           # delete PageSnapshot
            FakeResult(0),  # реальных страниц в спейсе не осталось
            None,           # bulk-delete виртуальных страниц спейса
            FakeResult(0),  # страниц в демо-проекте не осталось
        ]

        resp = self.client.delete(f"/api/pages/{page.id}")
        self.assertEqual(resp.status_code, 204, resp.text)
        self.assertIn(page, self.session.deleted)
        self.assertIn(demo, self.session.deleted)

    def test_delete_demo_page_keeps_project_with_remaining_pages(self):
        demo, page = self._make_demo_with_page()
        self.session.execute_results = [
            None,           # delete HighlightTest
            None,           # delete Highlight
            None,           # delete Baseline
            None,           # delete PageSnapshot
            FakeResult(1),  # в спейсе осталась другая демо-страница
            FakeResult(1),  # в проекте остались страницы — проект живёт
        ]

        resp = self.client.delete(f"/api/pages/{page.id}")
        self.assertEqual(resp.status_code, 204, resp.text)
        self.assertIn(page, self.session.deleted)
        self.assertNotIn(demo, self.session.deleted)


class TestTestsScreenEndpoints(ProjectTestBase):
    """Экран «Тесты» (v1.6.1): сводка проектов и реверс-индекс ключей.

    FakeSession не интерпретирует WHERE — скоуп «только ok-проекты» зашит в
    сам запрос членств; здесь проверяется агрегация и контроль доступа.
    """

    def test_stats_aggregates_counts(self):
        project = make_project(created_by=self.user.id)
        pg1, pg2, pg3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        h1, h2, h3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        self.session.execute_results = [
            [project],   # членства со статусом ok
            [],          # демо-проекта нет
            FakeResult([(pg1, project.id), (pg2, project.id), (pg3, project.id)]),
            FakeResult([(h1, pg1, "active"), (h2, pg1, "outdated"), (h3, pg2, "lost")]),
            # REQ-1 привязан дважды в разных написаниях — это ОДИН тест
            FakeResult([(h1, "REQ-1"), (h1, "req-1 "), (h2, "REQ-2")]),
            # свежесть автообновления (v1.6.2): последний успешный прогон
            FakeResult([(project.id, datetime(2026, 7, 16, 0, 12, tzinfo=timezone.utc))]),
            # последняя попытка (v1.6.4): успешная — предупреждения нет
            FakeResult([(project.id, "ok", None,
                         datetime(2026, 7, 16, 0, 12, tzinfo=timezone.utc))]),
        ]
        resp = self.client.get("/api/projects/stats")
        self.assertEqual(resp.status_code, 200, resp.text)
        [s] = resp.json()
        self.assertEqual(s["pages"], 3)
        self.assertEqual(s["highlights"], 3)
        self.assertEqual(s["active"], 1)
        self.assertEqual(s["outdated"], 1)
        self.assertEqual(s["lost"], 1)
        self.assertEqual(s["covered"], 2)   # у h3 тестов нет
        self.assertEqual(s["tests"], 2)     # REQ-1 (нормализован) и REQ-2
        self.assertTrue(s["last_auto_refresh_at"].startswith("2026-07-16T00:12"))
        self.assertIsNone(s["last_attempt_reason"])

    def test_stats_flags_failing_last_attempt(self):
        """Последний прогон не удался (VPN/сеть): карточка «Тестов» должна
        видеть и старую свежесть, и причину, почему она застыла."""
        project = make_project(created_by=self.user.id)
        self.session.execute_results = [
            [project],       # членства со статусом ok
            [],              # демо-проекта нет
            FakeResult([]),  # страниц нет
            # свежесть — успех был вчера
            FakeResult([(project.id, datetime(2026, 7, 15, 0, 12, tzinfo=timezone.utc))]),
            # последняя попытка — сегодня, упала по сети
            FakeResult([(project.id, "skipped",
                         {"skipped_reason": "confluence_unreachable"},
                         datetime(2026, 7, 16, 0, 12, tzinfo=timezone.utc))]),
        ]
        resp = self.client.get("/api/projects/stats")
        self.assertEqual(resp.status_code, 200, resp.text)
        [s] = resp.json()
        self.assertTrue(s["last_auto_refresh_at"].startswith("2026-07-15"))
        self.assertEqual(s["last_attempt_reason"], "confluence_unreachable")
        self.assertTrue(s["last_attempt_at"].startswith("2026-07-16"))

    def test_stats_empty_without_projects(self):
        self.session.execute_results = [[], []]
        resp = self.client.get("/api/projects/stats")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_test_index_aggregates_counts_without_quotes(self):
        """Лёгкий список (v1.7.3): ключи нормализуются и склеиваются, по
        каждому — счётчики статусов и страниц; цитат в ответе нет вовсе —
        их отдаёт /test-links при раскрытии строки."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        pg1, pg2 = uuid.uuid4(), uuid.uuid4()
        h1, h2 = uuid.uuid4(), uuid.uuid4()
        self.session.execute_results = [
            FakeResult(cred),   # членство ok
            FakeResult([(pg1,), (pg2,)]),
            # статусы БЕЗ text_content: список цитаты не поднимает
            FakeResult([(h1, pg1, "active"), (h2, pg2, "lost")]),
            # req-1 в двух написаниях склеивается в REQ-1
            FakeResult([(h1, "req-1"), (h2, "REQ-1"), (h2, "REQ-2")]),
        ]
        resp = self.client.get(f"/api/projects/{project.id}/tests")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual([t["key"] for t in data["tests"]], ["REQ-1", "REQ-2"])
        req1, req2 = data["tests"]
        self.assertEqual((req1["active"], req1["outdated"], req1["lost"]), (1, 0, 1))
        self.assertEqual(req1["pages_count"], 2)
        self.assertEqual((req2["active"], req2["outdated"], req2["lost"]), (0, 0, 1))
        self.assertEqual(req2["pages_count"], 1)
        # Общие страницы не двоятся: pg2 несёт и REQ-1, и REQ-2.
        self.assertEqual(data["pages_covered"], 2)
        self.assertNotIn("links", req1)

    def test_test_index_requires_membership(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(None)]   # кред нет
        resp = self.client.get(f"/api/projects/{project.id}/tests")
        self.assertEqual(resp.status_code, 403)

    def test_test_index_foreign_demo_is_404(self):
        project = make_project(is_demo=True)   # created_by — чужой
        self.session.objects[(Project, project.id)] = project
        resp = self.client.get(f"/api/projects/{project.id}/tests")
        self.assertEqual(resp.status_code, 404)

    def test_test_links_returns_full_quotes_sorted(self):
        """Раскрытие ключа (v1.7.3): привязки с полными цитатами, порядок —
        по названию страницы; ключ нормализуется (upper/trim)."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        long_text = "х" * 200
        pg1, pg2 = uuid.uuid4(), uuid.uuid4()
        h1, h2 = uuid.uuid4(), uuid.uuid4()
        l1, l2 = uuid.uuid4(), uuid.uuid4()
        self.session.execute_results = [
            FakeResult(cred),   # членство ok
            # join-строки: link_id, highlight_id, page_id, status, text, title
            FakeResult([
                (l1, h1, pg1, "active", long_text, "Оплата"),
                (l2, h2, pg2, "lost", "коротко", "Возвраты"),
            ]),
        ]
        resp = self.client.get(f"/api/projects/{project.id}/test-links?key=req-1%20")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["key"], "REQ-1")
        self.assertEqual([l["page_title"] for l in data["links"]], ["Возвраты", "Оплата"])
        # Цитата отдаётся целиком (v1.6.5): сколько показывать — line-clamp фронта.
        self.assertEqual(data["links"][1]["excerpt"], long_text)
        self.assertEqual(data["links"][0]["status"], "lost")

    def test_test_links_empty_is_ok_not_404(self):
        """Ключ отвязали, пока строка была открыта, — пустой список, не ошибка."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(cred), FakeResult([])]
        resp = self.client.get(f"/api/projects/{project.id}/test-links?key=REQ-9")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["links"], [])

    def test_test_links_requires_membership(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(None)]   # кред нет
        resp = self.client.get(f"/api/projects/{project.id}/test-links?key=REQ-1")
        self.assertEqual(resp.status_code, 403)

    def test_test_index_counts_uncovered(self):
        """Привязки без тестов (v1.7.5): индекс отдаёт их счётчики отдельным
        блоком — из уже загруженных строк, сами цитаты не поднимаются."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        pg1, pg2 = uuid.uuid4(), uuid.uuid4()
        h1, h2, h3, h4 = (uuid.uuid4() for _ in range(4))
        self.session.execute_results = [
            FakeResult(cred),   # членство ok
            FakeResult([(pg1,), (pg2,)]),
            FakeResult([
                (h1, pg1, "active"),     # покрыта REQ-1
                (h2, pg1, "outdated"),   # без тестов
                (h3, pg2, "lost"),       # без тестов
                (h4, pg2, "active"),     # без тестов
            ]),
            FakeResult([(h1, "REQ-1")]),
        ]
        resp = self.client.get(f"/api/projects/{project.id}/tests")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        unc = data["uncovered"]
        self.assertEqual((unc["active"], unc["outdated"], unc["lost"]), (1, 1, 1))
        self.assertEqual(unc["pages_count"], 2)
        # Список тестов непокрытые не трогают: REQ-1 как был один, так и есть.
        self.assertEqual([t["key"] for t in data["tests"]], ["REQ-1"])
        self.assertEqual(data["pages_covered"], 1)

    def test_uncovered_links_full_quotes_sorted_without_link_id(self):
        """Раскрытие «Привязок без тестов» (v1.7.5): полные цитаты, порядок по
        названию страницы; link_id пуст — записи HighlightTest не существует."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        long_text = "х" * 200
        pg1, pg2 = uuid.uuid4(), uuid.uuid4()
        h1, h2 = uuid.uuid4(), uuid.uuid4()
        self.session.execute_results = [
            FakeResult(cred),   # членство ok
            # строки: highlight_id, page_id, status, text, title
            FakeResult([
                (h1, pg1, "outdated", long_text, "Оплата"),
                (h2, pg2, "lost", "коротко", "Возвраты"),
            ]),
        ]
        resp = self.client.get(f"/api/projects/{project.id}/uncovered-links")
        self.assertEqual(resp.status_code, 200, resp.text)
        links = resp.json()["links"]
        self.assertEqual([l["page_title"] for l in links], ["Возвраты", "Оплата"])
        self.assertEqual(links[0]["status"], "lost")
        self.assertEqual(links[1]["excerpt"], long_text)
        self.assertTrue(all(l["link_id"] is None for l in links))

    def test_uncovered_links_empty_is_ok_not_404(self):
        """Последнюю непокрытую привязку покрыли, пока строка была открыта, —
        пустой список, не ошибка."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(cred), FakeResult([])]
        resp = self.client.get(f"/api/projects/{project.id}/uncovered-links")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["links"], [])

    def test_uncovered_links_requires_membership(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(None)]   # кред нет
        resp = self.client.get(f"/api/projects/{project.id}/uncovered-links")
        self.assertEqual(resp.status_code, 403)


class TestCoverageCsv(ProjectTestBase):
    """Выгружаемый срез покрытия (v1.8.1): GET /{id}/coverage.csv."""

    def test_csv_row_per_link_and_uncovered_row(self):
        """Строка = привязка × тест; привязка без тестов — строка с пустым
        тестом; статусы по-русски, ключ нормализован, BOM + «;» + CRLF."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        created = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        self.session.execute_results = [
            FakeResult(cred),   # членство ok
            # строки: title, space, url, status, quote, created_at, author, key
            FakeResult([
                ("Оплата", "SPC", "https://c/1", "active",
                 "Цитата; с точкой с запятой", created, "QA Surf", "req-1"),
                ("Оплата", "SPC", "https://c/1", "outdated",
                 "Без теста", created, "QA Surf", None),
            ]),
            FakeResult([]),     # кэша названий (test_details) нет
        ]

        resp = self.client.get(f"/api/projects/{project.id}/coverage.csv")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertIn("text/csv", resp.headers["content-type"])
        self.assertIn("attachment", resp.headers["content-disposition"])

        text = resp.content.decode("utf-8")
        self.assertTrue(text.startswith("\ufeff"))  # BOM — для русского Excel
        lines = text.lstrip("\ufeff").strip("\r\n").split("\r\n")
        self.assertEqual(len(lines), 3)  # шапка + 2 строки
        self.assertEqual(lines[0].split(";")[0], "Страница")
        # Сортировка по (страница, цитата): «Без теста» < «Цитата…».
        self.assertIn("Требует проверки", lines[1])
        self.assertIn(";;", lines[1])   # колонки теста пусты
        self.assertIn("REQ-1", lines[2])  # ключ нормализован из req-1
        self.assertIn("Актуально", lines[2])
        # «;» внутри цитаты — поле в кавычках, столбцы не разъезжаются.
        self.assertIn('"Цитата; с точкой с запятой"', lines[2])
        self.assertIn("01.08.2026", lines[2])

    def test_csv_uses_cached_jira_summaries(self):
        """Название теста — из кэша test_details (ночная синхронизация Jira)."""
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project

        class FakeDetail:
            summary = "Оплата картой"

        created = datetime(2026, 8, 1, tzinfo=timezone.utc)
        self.session.execute_results = [
            FakeResult(cred),
            FakeResult([
                ("Оплата", "SPC", "https://c/1", "active", "Цитата",
                 created, "QA Surf", "REQ-1"),
            ]),
        ]
        with patch("app.routers.projects.test_names.load_details",
                   new=AsyncMock(return_value={"REQ-1": FakeDetail()})):
            resp = self.client.get(f"/api/projects/{project.id}/coverage.csv")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertIn("Оплата картой", resp.content.decode("utf-8"))

    def test_csv_requires_membership(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(None)]   # кред нет
        resp = self.client.get(f"/api/projects/{project.id}/coverage.csv")
        self.assertEqual(resp.status_code, 403)

    def test_csv_foreign_demo_is_404(self):
        project = make_project(is_demo=True)   # created_by — чужой
        self.session.objects[(Project, project.id)] = project
        resp = self.client.get(f"/api/projects/{project.id}/coverage.csv")
        self.assertEqual(resp.status_code, 404)


class TestManualRefreshRun(ProjectTestBase):
    """Ручной прогон с карточки проекта (v1.6.4): POST /{id}/refresh-run.

    Сам прогон здесь замокан (start_manual_run) — его поведение покрывает
    test_nightly_refresh; тут — доступ и контракт 202/409.
    """

    START = "app.routers.projects.start_manual_run"

    def test_member_starts_background_run(self):
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(cred)]  # членство ok
        with patch(self.START, new=AsyncMock(return_value=True)) as start:
            resp = self.client.post(f"/api/projects/{project.id}/refresh-run")

        self.assertEqual(resp.status_code, 202, resp.text)
        self.assertEqual(resp.json(), {"started": True})
        # Прогон идёт от имени нажавшего — его креды в приоритете.
        start.assert_awaited_once_with(project.id, prefer_user_id=self.user.id)

    def test_busy_lock_is_409(self):
        project = make_project()
        cred = make_cred(project, self.user)
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(cred)]
        with patch(self.START, new=AsyncMock(return_value=False)):
            resp = self.client.post(f"/api/projects/{project.id}/refresh-run")

        self.assertEqual(resp.status_code, 409)
        self.assertIn("уже идёт", resp.json()["detail"])

    def test_non_member_is_403(self):
        project = make_project()
        self.session.objects[(Project, project.id)] = project
        self.session.execute_results = [FakeResult(None)]  # кред нет
        with patch(self.START, new=AsyncMock(return_value=True)) as start:
            resp = self.client.post(f"/api/projects/{project.id}/refresh-run")

        self.assertEqual(resp.status_code, 403)
        start.assert_not_awaited()

    def test_demo_project_is_404(self):
        project = make_project(is_demo=True, created_by=self.user.id)
        self.session.objects[(Project, project.id)] = project
        with patch(self.START, new=AsyncMock(return_value=True)) as start:
            resp = self.client.post(f"/api/projects/{project.id}/refresh-run")

        self.assertEqual(resp.status_code, 404)
        start.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
