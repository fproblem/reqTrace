"""Тесты панели уведомлений (v1.6.3, план — auto-refresh-plan-v1.6.md §3.4).

Главное свойство — «только участникам» по построению: уведомления собираются
выборкой от членств пользователя, рассылок нет. Группы:
1. Дайджест прогона: счётчики, агрегация затронутых тест-ключей из details,
   причина прерванного прогона; тихий прогон в панель не попадает.
2. Видимость: дайджест — только при рабочем (ok) подключении; личная запись
   «ваши креды отклонены» — по самому факту членства (даже invalid), чужие
   cred_issues не показываются.
3. Пропущенные прогоны: unreachable/no_valid_credentials видны, no_credentials
   не показывается.
4. Непрочитанное: отметка notifications_seen_at, бейдж, POST /seen.

Обход всех маршрутов на 401 без cookie — в test_auth.py, он накрывает и
роутер notifications (подключён с protected-зависимостью).

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import unittest
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi.testclient import TestClient

from app.auth import JWT_ALGORITHM, SESSION_COOKIE_NAME
from app.config import settings
from app.database import get_db
from app.main import app
from app.models.project import Project, ProjectCredential
from app.models.refresh_run import RefreshRun
from app.models.user import User

TEST_SECRET = "test-session-secret"
NOW = datetime(2026, 7, 16, 0, 12, tzinfo=timezone.utc)


class FakeScalars:
    def __init__(self, value):
        self._value = value

    def all(self):
        return list(self._value or [])


class FakeResult:
    def __init__(self, value):
        self._value = value

    def all(self):
        return list(self._value or [])

    def scalars(self):
        return FakeScalars(self._value)


class FakeSession:
    def __init__(self, execute_results=None, objects=None):
        self.execute_results = list(execute_results or [])
        self.objects = objects or {}

    async def execute(self, stmt):
        value = self.execute_results.pop(0) if self.execute_results else None
        return value if isinstance(value, FakeResult) else FakeResult(value)

    async def get(self, model, pk, options=None):
        return self.objects.get((model, pk))

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def rollback(self):
        pass


def make_project(name="Банк X"):
    project = Project(name=name, confluence_base_url="https://conf.bank-x.ru", created_by=uuid.uuid4())
    project.id = uuid.uuid4()
    project.is_demo = False
    return project


def make_cred(project, user, status="ok"):
    cred = ProjectCredential(
        project_id=project.id,
        user_id=user.id,
        confluence_username="d.pechkin",
        confluence_password_enc="enc",
        status=status,
    )
    cred.id = uuid.uuid4()
    return cred


def make_run(project, *, status="ok", finished_at=NOW, started_at=None,
             to_outdated=0, to_lost=0,
             pages_total=0, pages_changed=0, pages_failed=0,
             details=None, cred_issues=None):
    run = RefreshRun(project_id=project.id, trigger="auto")
    run.id = uuid.uuid4()
    run.status = status
    run.started_at = started_at or finished_at or NOW
    run.finished_at = finished_at
    run.pages_total = pages_total
    run.pages_changed = pages_changed
    run.pages_failed = pages_failed
    run.to_outdated = to_outdated
    run.to_lost = to_lost
    run.details = details
    run.cred_issues = cred_issues
    return run


class NotificationsBase(unittest.TestCase):
    def setUp(self):
        settings.SESSION_SECRET = TEST_SECRET
        self.user = User(name="QA Surf", email="qa@surf.dev")
        self.user.id = uuid.uuid4()
        self.user.notifications_seen_at = None

        self.session = FakeSession(objects={(User, self.user.id): self.user})
        app.dependency_overrides[get_db] = lambda: self.session
        self.client = TestClient(app)
        payload = {
            "sub": str(self.user.id),
            "email": self.user.email,
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        }
        self.client.cookies.set(
            SESSION_COOKIE_NAME, jwt.encode(payload, TEST_SECRET, algorithm=JWT_ALGORITHM)
        )

    def tearDown(self):
        app.dependency_overrides.clear()

    def get_entries(self, creds, run_rows):
        """creds — мои членства; run_rows — [(run, project_name)] из журнала."""
        self.session.execute_results = [creds, FakeResult(run_rows)]
        resp = self.client.get("/api/notifications")
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()


class DigestEntriesTest(NotificationsBase):
    def test_digest_composed_from_run(self):
        project = make_project()
        cred = make_cred(project, self.user)
        run = make_run(
            project, to_outdated=4, to_lost=1,
            pages_total=14, pages_changed=3, pages_failed=2,
            details={"pages": [
                {"page_id": "p1", "affected_tests": ["PAY-4", "PAY-1"]},
                {"page_id": "p2", "affected_tests": ["PAY-1", "REQ-2"]},
                {"page_id": "p3", "title": "Команда", "error": "Failed to fetch"},
                {"page_id": "p4", "title": "iOS Jailbreak", "error": "ReadTimeout"},
            ]},
        )
        data = self.get_entries([cred], [(run, project.name)])

        [entry] = data["entries"]
        self.assertEqual(entry["kind"], "digest")
        self.assertEqual(entry["project_name"], "Банк X")
        self.assertEqual(entry["to_outdated"], 4)
        self.assertEqual(entry["to_lost"], 1)
        self.assertEqual(entry["pages_total"], 14)
        self.assertEqual(entry["pages_changed"], 3)
        # Ключи собраны по всем страницам details, без дублей, по алфавиту.
        self.assertEqual(entry["affected_tests"], ["PAY-1", "PAY-4", "REQ-2"])
        # Страницы с ошибкой — по названиям, в порядке прогона (v1.7.2);
        # страницы с находками (без "error") в списке не оказываются.
        self.assertEqual(entry["failed_pages"], ["Команда", "iOS Jailbreak"])
        self.assertTrue(entry["unseen"])
        self.assertEqual(data["unseen_count"], 1)

    def test_quiet_run_is_confirmation_not_news(self):
        """Тихий прогон (v1.6.5) — строка-состояние «изменений нет», но не
        новость: бейдж не зажигается, непрочитанным не считается."""
        project = make_project()
        cred = make_cred(project, self.user)
        run = make_run(project, pages_total=14, pages_changed=0)
        data = self.get_entries([cred], [(run, project.name)])
        [entry] = data["entries"]
        self.assertEqual(entry["kind"], "run_quiet")
        self.assertFalse(entry["unseen"])
        self.assertEqual(data["unseen_count"], 0)
        self.assertEqual(data["unseen_count"], 0)

    def test_retry_promise_on_latest_settled_run_with_failures_today(self):
        """Обещание добора (v1.7.2): последний состоявшийся прогон проекта —
        сегодняшний partial с ошибками страниц → планировщик доберёт их,
        и дайджест обязан это сказать."""
        project = make_project()
        cred = make_cred(project, self.user)
        run = make_run(
            project, status="partial", pages_total=5, pages_failed=1,
            finished_at=datetime.now(timezone.utc),
            details={"pages": [{"page_id": "p1", "title": "Команда", "error": "boom"}]},
        )
        data = self.get_entries([cred], [(run, project.name)])
        [entry] = data["entries"]
        self.assertEqual(entry["failed_pages"], ["Команда"])
        self.assertTrue(entry["retry_planned"])

    def test_no_retry_promise_when_newer_run_settled(self):
        """Успешный ретрай (или любой более свежий состоявшийся прогон)
        гасит обещание у старого дайджеста."""
        project = make_project()
        cred = make_cred(project, self.user)
        now = datetime.now(timezone.utc)
        old_failed = make_run(
            project, status="partial", pages_total=5, pages_failed=1,
            finished_at=now - timedelta(hours=3),
            details={"pages": [{"page_id": "p1", "title": "Команда", "error": "boom"}]},
        )
        newer_ok = make_run(
            project, status="ok", pages_total=1, pages_changed=1, to_outdated=1,
            finished_at=now,
        )
        data = self.get_entries(
            [cred], [(newer_ok, project.name), (old_failed, project.name)]
        )
        old_digest = next(
            e for e in data["entries"] if e["id"] == f"{old_failed.id}:digest"
        )
        self.assertFalse(old_digest["retry_planned"])

    def test_interrupted_run_carries_reason_on_digest(self):
        project = make_project()
        cred = make_cred(project, self.user)
        run = make_run(
            project, status="partial", to_outdated=2, pages_total=9,
            details={"skipped_reason": "no_valid_credentials", "pages": []},
        )
        data = self.get_entries([cred], [(run, project.name)])
        [entry] = data["entries"]
        self.assertEqual(entry["kind"], "digest")
        self.assertEqual(entry["skipped_reason"], "no_valid_credentials")


class VisibilityTest(NotificationsBase):
    def test_digest_hidden_without_ok_membership_but_cred_issue_is_personal(self):
        """Мой пароль протух этой ночью: дайджест проекта скрыт (нет ok-доступа),
        но личная запись «ваши креды отклонены» обязана дойти."""
        project = make_project()
        cred = make_cred(project, self.user, status="invalid")
        run = make_run(
            project, to_outdated=3, pages_total=5,
            cred_issues=[{
                "user_id": str(self.user.id), "username": "d.pechkin", "result": "invalid",
            }],
        )
        data = self.get_entries([cred], [(run, project.name)])
        [entry] = data["entries"]
        self.assertEqual(entry["kind"], "cred_invalid")
        self.assertEqual(entry["project_name"], "Банк X")

    def test_foreign_cred_issues_are_not_mine(self):
        project = make_project()
        cred = make_cred(project, self.user)
        run = make_run(
            project, to_outdated=1, pages_total=5,
            cred_issues=[{
                "user_id": str(uuid.uuid4()), "username": "colleague", "result": "invalid",
            }],
        )
        data = self.get_entries([cred], [(run, project.name)])
        # Только дайджест; чужая беда с кредами — не моё уведомление.
        self.assertEqual([e["kind"] for e in data["entries"]], ["digest"])

    def test_no_memberships_no_notifications(self):
        data = self.get_entries([], None)
        self.assertEqual(data, {"unseen_count": 0, "entries": []})


class FailureStateTest(NotificationsBase):
    """«Не выполнено» — состояние, а не событие: почасовое самолечение не
    должно заваливать панель повторами и топить дайджесты изменений."""

    def test_trailing_failures_collapse_into_single_live_entry(self):
        project = make_project()
        cred = make_cred(project, self.user)
        runs = [
            (make_run(project, status="skipped", finished_at=NOW,
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
            (make_run(project, status="skipped", finished_at=NOW - timedelta(hours=1),
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
            (make_run(project, status="skipped", finished_at=NOW - timedelta(hours=2),
                      details={"skipped_reason": "no_valid_credentials"}), project.name),
            # Успешный прогон позади серии — её граница.
            (make_run(project, finished_at=NOW - timedelta(hours=3)), project.name),
        ]
        data = self.get_entries([cred], runs)

        [entry] = data["entries"]
        self.assertEqual(entry["kind"], "run_skipped")
        self.assertEqual(entry["attempts"], 3)
        # Причина — от последней попытки; времена — границы серии.
        self.assertEqual(entry["skipped_reason"], "confluence_unreachable")
        self.assertTrue(entry["happened_at"].startswith("2026-07-16T00:12"))
        self.assertTrue(entry["first_attempt_at"].startswith("2026-07-15T22:12"))

    def test_success_breaks_streak_and_hides_stale_failures(self):
        project = make_project()
        cred = make_cred(project, self.user)
        runs = [
            # Свежий тихий успех: состояние разрешилось — вместо «не выполнено»
            # спокойное подтверждение тишины (v1.6.5).
            (make_run(project, finished_at=NOW, pages_total=5), project.name),
            (make_run(project, status="skipped", finished_at=NOW - timedelta(hours=1),
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
            (make_run(project, status="skipped", finished_at=NOW - timedelta(hours=2),
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
        ]
        data = self.get_entries([cred], runs)
        [entry] = data["entries"]
        self.assertEqual(entry["kind"], "run_quiet")
        # Тишина началась этим прогоном: неудачи в серию не входят.
        self.assertEqual(entry["attempts"], 1)
        self.assertEqual(data["unseen_count"], 0)

    def test_failures_behind_latest_digest_are_history(self):
        project = make_project()
        cred = make_cred(project, self.user)
        runs = [
            (make_run(project, to_outdated=2, pages_total=5, finished_at=NOW), project.name),
            (make_run(project, status="skipped", finished_at=NOW - timedelta(hours=1),
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
        ]
        data = self.get_entries([cred], runs)
        self.assertEqual([e["kind"] for e in data["entries"]], ["digest"])

    def test_hidden_no_credentials_does_not_join_streak(self):
        project = make_project()
        cred = make_cred(project, self.user)
        runs = [
            (make_run(project, status="skipped", finished_at=NOW,
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
            # no_credentials скрыт и серию разрывает.
            (make_run(project, status="skipped", finished_at=NOW - timedelta(hours=1),
                      details={"skipped_reason": "no_credentials"}), project.name),
            (make_run(project, status="skipped", finished_at=NOW - timedelta(hours=2),
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
        ]
        data = self.get_entries([cred], runs)
        [entry] = data["entries"]
        self.assertEqual(entry["attempts"], 1)


class QuietStateTest(NotificationsBase):
    """«Изменений нет» — состояние-подтверждение (v1.6.5): неделя тишины —
    одна строка, а не семь; уверенность, что слежение живо, без шума."""

    def test_quiet_days_collapse_into_single_entry(self):
        project = make_project()
        cred = make_cred(project, self.user)
        runs = [
            (make_run(project, finished_at=NOW, pages_total=5), project.name),
            (make_run(project, finished_at=NOW - timedelta(days=1), pages_total=5), project.name),
            (make_run(project, finished_at=NOW - timedelta(days=2), pages_total=5), project.name),
        ]
        data = self.get_entries([cred], runs)

        [entry] = data["entries"]
        self.assertEqual(entry["kind"], "run_quiet")
        self.assertEqual(entry["attempts"], 3)
        # happened_at — последний прогон, first_attempt_at — начало тишины.
        self.assertTrue(entry["happened_at"].startswith("2026-07-16T00:12"))
        self.assertTrue(entry["first_attempt_at"].startswith("2026-07-14T00:12"))

    def test_digest_breaks_quiet_streak_and_stays_alongside(self):
        project = make_project()
        cred = make_cred(project, self.user)
        runs = [
            (make_run(project, finished_at=NOW, pages_total=5), project.name),
            # Позавчерашние находки — граница тишины; их дайджест остаётся в ленте.
            (make_run(project, to_outdated=1, pages_total=5,
                      finished_at=NOW - timedelta(days=1)), project.name),
            (make_run(project, finished_at=NOW - timedelta(days=2), pages_total=5), project.name),
        ]
        data = self.get_entries([cred], runs)

        self.assertEqual([e["kind"] for e in data["entries"]], ["run_quiet", "digest"])
        quiet = data["entries"][0]
        self.assertEqual(quiet["attempts"], 1)

    def test_trailing_failure_supersedes_quiet_state(self):
        project = make_project()
        cred = make_cred(project, self.user)
        runs = [
            (make_run(project, status="skipped", finished_at=NOW,
                      details={"skipped_reason": "confluence_unreachable"}), project.name),
            (make_run(project, finished_at=NOW - timedelta(days=1), pages_total=5), project.name),
        ]
        data = self.get_entries([cred], runs)
        # Последняя попытка неудачна — панель говорит о проблеме, не о тишине.
        self.assertEqual([e["kind"] for e in data["entries"]], ["run_skipped"])

    def test_quiet_state_needs_ok_membership(self):
        project = make_project()
        cred = make_cred(project, self.user, status="invalid")
        run = make_run(project, finished_at=NOW, pages_total=5)
        data = self.get_entries([cred], [(run, project.name)])
        self.assertEqual(data["entries"], [])


class FailureUnseenMarkerTest(unittest.TestCase):
    """Бейдж напоминает о продолжающейся проблеме раз в день, не каждый добор."""

    TZ = timezone.utc

    def test_marker_is_first_attempt_of_today(self):
        from app.routers.notifications import failure_unseen_marker
        today = NOW.date()  # 2026-07-16
        first_today = datetime(2026, 7, 16, 3, 12, tzinfo=timezone.utc)
        finished_desc = [
            datetime(2026, 7, 16, 8, 12, tzinfo=timezone.utc),
            first_today,
            datetime(2026, 7, 15, 22, 0, tzinfo=timezone.utc),  # вчера — не в счёт
        ]
        self.assertEqual(failure_unseen_marker(finished_desc, today, self.TZ), first_today)

    def test_streak_without_todays_attempts_counts_from_its_start(self):
        from app.routers.notifications import failure_unseen_marker
        today = NOW.date()
        finished_desc = [NOW - timedelta(days=1), NOW - timedelta(days=2)]
        self.assertEqual(
            failure_unseen_marker(finished_desc, today, self.TZ),
            NOW - timedelta(days=2),
        )


class InterruptedRunTest(NotificationsBase):
    def test_network_interrupted_run_still_delivers_digest(self):
        """Связь оборвалась посреди прогона (v1.6.4): найденные до обрыва
        переходы уже применены к привязкам, добор их повторно «не увидит» —
        дайджест обязан выйти из той же строки журнала, вместе с «не выполнено»."""
        project = make_project()
        cred = make_cred(project, self.user)
        run = make_run(
            project, status="skipped", to_outdated=2, pages_total=9, pages_changed=1,
            details={"skipped_reason": "confluence_unreachable", "pages": []},
        )
        data = self.get_entries([cred], [(run, project.name)])
        kinds = sorted(e["kind"] for e in data["entries"])
        self.assertEqual(kinds, ["digest", "run_skipped"])
        digest = next(e for e in data["entries"] if e["kind"] == "digest")
        self.assertEqual(digest["to_outdated"], 2)
        self.assertEqual(digest["skipped_reason"], "confluence_unreachable")


class RefreshStatusTest(NotificationsBase):
    """Индикатор у колокольчика: что идёт сейчас и чем кончился последний."""

    def test_running_and_last_finished(self):
        project = make_project()
        cred = make_cred(project, self.user)
        active = make_run(project, finished_at=None, started_at=NOW)
        done = make_run(project, to_outdated=2, finished_at=NOW - timedelta(minutes=5))
        self.session.execute_results = [
            [cred],
            FakeResult([(active, project.name)]),
            FakeResult([(done, project.name)]),
        ]
        resp = self.client.get("/api/notifications/refresh-status")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()

        [running] = data["running"]
        self.assertEqual(running["project_name"], "Банк X")
        self.assertEqual(running["trigger"], "auto")
        self.assertEqual(data["last_finished"]["to_outdated"], 2)
        self.assertEqual(data["last_finished"]["status"], "ok")

    def test_without_ok_membership_status_is_empty(self):
        project = make_project()
        cred = make_cred(project, self.user, status="invalid")
        self.session.execute_results = [[cred]]
        resp = self.client.get("/api/notifications/refresh-status")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"running": [], "last_finished": None})


class SeenTest(NotificationsBase):
    def test_entries_older_than_mark_are_read(self):
        self.user.notifications_seen_at = NOW + timedelta(hours=6)
        project = make_project()
        cred = make_cred(project, self.user)
        old = make_run(project, to_outdated=1, pages_total=3, finished_at=NOW)
        fresh = make_run(
            project, to_lost=1, pages_total=3, finished_at=NOW + timedelta(days=1))
        data = self.get_entries([cred], [(fresh, project.name), (old, project.name)])

        by_id = {e["id"]: e for e in data["entries"]}
        self.assertTrue(by_id[f"{fresh.id}:digest"]["unseen"])
        self.assertFalse(by_id[f"{old.id}:digest"]["unseen"])
        self.assertEqual(data["unseen_count"], 1)
        # Свежее — первым (сортировка по времени события).
        self.assertEqual(data["entries"][0]["id"], f"{fresh.id}:digest")

    def test_mark_seen_sets_timestamp(self):
        self.assertIsNone(self.user.notifications_seen_at)
        resp = self.client.post("/api/notifications/seen")
        self.assertEqual(resp.status_code, 204)
        self.assertIsNotNone(self.user.notifications_seen_at)


if __name__ == "__main__":
    unittest.main()
