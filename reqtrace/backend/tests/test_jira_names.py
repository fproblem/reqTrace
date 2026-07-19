"""Тесты названий тестов из Jira (v1.7.0, план — jira-test-names-plan-v1.7.md).

Границы фичи: ReqTrace читает из Jira ТОЛЬКО summary (модуль services/jira
содержит одни GET). Сеть — фейковый get; БД — FakeSession (очередь execute).

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import asyncio
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet

from app.config import settings
from app.crypto import encrypt_secret
from app.models.project import Project, ProjectCredential
from app.services import jira
from app.services.jira import JiraAuthError, is_likely_jira_key
from app.services.test_names import (
    sync_project_test_names,
    upsert_test_detail,
)
from app.models.test_detail import TestDetail


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def fake_get(routes):
    """routes: часть URL → FakeResponse | callable(params)->FakeResponse."""
    calls = []

    async def get(url, token, params=None):
        calls.append((url, params))
        for fragment, resp in routes.items():
            if fragment in url:
                return resp(params) if callable(resp) else resp
        raise AssertionError(f"неожиданный URL: {url}")

    get.calls = calls
    return get


class KeyFormatTest(unittest.TestCase):
    def test_mirror_of_frontend_rule(self):
        self.assertTrue(is_likely_jira_key("TEST-123"))
        self.assertTrue(is_likely_jira_key("si-12847"))  # регистр не ошибка
        self.assertFalse(is_likely_jira_key("123"))
        self.assertFalse(is_likely_jira_key("ПРОЕКТ-1"))
        self.assertFalse(is_likely_jira_key(""))


class FetchSummaryTest(unittest.TestCase):
    def test_ok(self):
        get = fake_get({"/rest/api/2/issue/TEST-1": FakeResponse(
            200, {"fields": {"summary": "Оплата картой"}},
        )})
        summary, result = asyncio.run(
            jira.fetch_summary("https://j", "tok", "TEST-1", get=get)
        )
        self.assertEqual((summary, result), ("Оплата картой", "ok"))

    def test_not_found_and_auth(self):
        get = fake_get({"/issue/": FakeResponse(404)})
        self.assertEqual(
            asyncio.run(jira.fetch_summary("https://j", "t", "TEST-9", get=get)),
            (None, "not_found"),
        )
        get401 = fake_get({"/issue/": FakeResponse(401)})
        with self.assertRaises(JiraAuthError):
            asyncio.run(jira.fetch_summary("https://j", "t", "TEST-9", get=get401))


class FetchSummariesTest(unittest.TestCase):
    def test_batch_matches_only_requested_keys(self):
        # «Переехавшая» задача возвращается с ЧУЖИМ ключом — не матчится,
        # вызывающий доберёт её точечно.
        get = fake_get({"/rest/api/2/search": FakeResponse(200, {"issues": [
            {"key": "TEST-1", "fields": {"summary": "Первый"}},
            {"key": "MOVED-77", "fields": {"summary": "Переехавший"}},
        ]})})
        found = asyncio.run(
            jira.fetch_summaries("https://j", "t", ["TEST-1", "TEST-2"], get=get)
        )
        self.assertEqual(found, {"TEST-1": "Первый"})
        # validateQuery=false обязателен — иначе мёртвый ключ роняет батч.
        _, params = get.calls[0]
        self.assertEqual(params["validateQuery"], "false")

    def test_failed_batch_returns_partial_not_raises(self):
        get = fake_get({"/search": FakeResponse(400)})
        found = asyncio.run(jira.fetch_summaries("https://j", "t", ["A-1"], get=get))
        self.assertEqual(found, {})

    def test_auth_error_raises(self):
        get = fake_get({"/search": FakeResponse(403)})
        with self.assertRaises(JiraAuthError):
            asyncio.run(jira.fetch_summaries("https://j", "t", ["A-1"], get=get))


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return list(self._value or [])


class FakeSession:
    def __init__(self, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added = []
        self.commits = 0

    async def execute(self, stmt):
        value = self.execute_results.pop(0) if self.execute_results else None
        return value if isinstance(value, FakeResult) else FakeResult(value)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def commit(self):
        self.commits += 1


class UpsertRulesTest(unittest.TestCase):
    """ok перезаписывает всё; not_found/error не затирают добытое имя."""

    def test_insert_and_ok_overwrites(self):
        session = FakeSession([FakeResult(None)])
        asyncio.run(upsert_test_detail(session, uuid.uuid4(), "test-1", "Имя", "ok"))
        [row] = session.added
        self.assertEqual((row.test_key, row.summary, row.fetch_result), ("TEST-1", "Имя", "ok"))

    def test_not_found_does_not_erase_existing_summary(self):
        existing = TestDetail(
            project_id=uuid.uuid4(), test_key="TEST-1",
            summary="Добытое имя", fetch_result="ok",
        )
        session = FakeSession([FakeResult(existing)])
        asyncio.run(upsert_test_detail(session, existing.project_id, "TEST-1", None, "not_found"))
        self.assertEqual(existing.summary, "Добытое имя")
        self.assertEqual(existing.fetch_result, "ok")

    def test_ok_updates_existing(self):
        existing = TestDetail(
            project_id=uuid.uuid4(), test_key="TEST-1",
            summary="Старое", fetch_result="ok",
        )
        session = FakeSession([FakeResult(existing)])
        asyncio.run(upsert_test_detail(session, existing.project_id, "TEST-1", "Новое", "ok"))
        self.assertEqual(existing.summary, "Новое")


class FakeSessionFactory:
    def __init__(self, session):
        self.session = session

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *exc):
        return False


def make_project():
    project = Project(
        name="Банк X", confluence_base_url="https://conf.x", created_by=uuid.uuid4(),
    )
    project.id = uuid.uuid4()
    project.is_demo = False
    project.jira_base_url = "https://jira.x"
    return project


def make_cred(project, *, token="pat-token"):
    cred = ProjectCredential(
        project_id=project.id,
        user_id=uuid.uuid4(),
        confluence_username="d.pechkin",
        confluence_password_enc="enc",
        status="ok",
    )
    cred.id = uuid.uuid4()
    cred.jira_token_enc = encrypt_secret(token)
    cred.jira_token_status = "ok"
    return cred


class SyncProjectTestNamesTest(unittest.TestCase):
    """Ночная синхронизация: батч + точечный добор, ретеншн, смена участника
    при отклонённом токене."""

    def setUp(self):
        settings.CREDENTIALS_KEY = Fernet.generate_key().decode()

    def test_batch_point_fallback_and_upserts(self):
        project = make_project()
        cred = make_cred(project)
        session = FakeSession([
            # Ключи привязок: Jira-подобные + мусор, который не запрашивается.
            FakeResult([("TEST-1",), ("test-2",), ("мимо",)]),
            FakeResult(None),          # ретеншн-delete
            FakeResult([cred]),        # участники с токеном
            FakeResult(None),          # upsert TEST-1 (нет строки)
            FakeResult(None),          # upsert TEST-2 (нет строки)
        ])
        with patch(
            "app.services.test_names.jira.fetch_summaries",
            new=AsyncMock(return_value={"TEST-1": "Первый"}),
        ) as batch, patch(
            "app.services.test_names.jira.fetch_summary",
            new=AsyncMock(return_value=(None, "not_found")),
        ) as point:
            count = asyncio.run(
                sync_project_test_names(FakeSessionFactory(session), project)
            )

        self.assertEqual(count, 2)
        batch.assert_awaited_once()
        self.assertEqual(batch.await_args.args[2], ["TEST-1", "TEST-2"])
        # TEST-2 не вернулся из батча (переехал/удалён) — добор точечно.
        point.assert_awaited_once()
        self.assertEqual(point.await_args.args[2], "TEST-2")
        by_key = {row.test_key: row for row in session.added}
        self.assertEqual(by_key["TEST-1"].summary, "Первый")
        self.assertEqual(by_key["TEST-2"].fetch_result, "not_found")

    def test_rejected_token_marks_invalid_and_passes_turn(self):
        project = make_project()
        cred1, cred2 = make_cred(project), make_cred(project)
        session = FakeSession([
            FakeResult([("TEST-1",)]),
            FakeResult(None),               # ретеншн
            FakeResult([cred1, cred2]),     # оба с токенами
            FakeResult(None),               # upsert после успеха второго
        ])
        with patch(
            "app.services.test_names.jira.fetch_summaries",
            new=AsyncMock(side_effect=[jira.JiraAuthError(401), {"TEST-1": "Имя"}]),
        ):
            count = asyncio.run(
                sync_project_test_names(FakeSessionFactory(session), project)
            )

        self.assertEqual(count, 1)
        self.assertEqual(cred1.jira_token_status, "invalid")
        self.assertEqual(cred2.jira_token_status, "ok")

    def test_network_failure_is_silent_until_next_night(self):
        project = make_project()
        cred = make_cred(project)
        session = FakeSession([
            FakeResult([("TEST-1",)]),
            FakeResult(None),
            FakeResult([cred]),
        ])
        with patch(
            "app.services.test_names.jira.fetch_summaries",
            new=AsyncMock(side_effect=RuntimeError("vpn down")),
        ):
            count = asyncio.run(
                sync_project_test_names(FakeSessionFactory(session), project)
            )
        self.assertEqual(count, 0)
        self.assertEqual(session.added, [])
        self.assertEqual(cred.jira_token_status, "ok")

    def test_project_without_jira_url_is_silent(self):
        project = make_project()
        project.jira_base_url = None
        session = FakeSession([])
        count = asyncio.run(
            sync_project_test_names(FakeSessionFactory(session), project)
        )
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
