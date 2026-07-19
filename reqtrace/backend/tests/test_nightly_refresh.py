"""Тесты ночного прогона автообновления (v1.6.2, план — auto-refresh-plan-v1.6.md).

Группы:
1. Чистые функции: классификация переходов статусов для журнала
   (status_transitions) и расписание (parse_hhmm, is_run_due — включая
   таймзону: контейнер живёт в UTC, «сегодня» считается по AUTO_REFRESH_TZ).
2. run_project: агрегация журнала — счётчики страниц/переходов, details
   только о страницах «с новостями», затронутые тест-ключи, итоги sync-tree;
   тихий прогон без подробностей.
3. Аккуратность с кредами: перепроверка обновляет last_check_* (живая дата в
   профиле), отказ Confluence → invalid + cred_issues, недоступность → перенос
   прогона БЕЗ порчи статусов, 401/403 посреди прогона → переключение на
   следующего участника, исчерпание → partial.
4. Ошибки страниц: 502 одной страницы не валит прогон остальных.
5. run_sweep: падение прогона одного проекта не трогает другие проекты.

Правила самих статусов привязок здесь НЕ проверяются — они в test_anchoring
и test_page_service; конвейер refresh замокан.

БД не нужна: сессии — FakeSession (очередь execute-результатов по порядку
запросов, как в test_projects), Confluence и конвейер — моки.

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import asyncio
import unittest
import uuid
from datetime import datetime, time as dtime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
from fastapi import HTTPException

from app.config import settings
from app.crypto import encrypt_secret
from app.jobs.nightly import (
    pick_retry_projects,
    prune_journal,
    run_project,
    run_sweep,
    status_transitions,
)
from app.jobs.scheduler import is_run_due, parse_hhmm
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.refresh_run import RefreshRun
from app.services.confluence import ConfluenceAuthError
from app.services.tree_sync import TreeSyncStats

CHECK_CONNECTION = "app.services.confluence.check_connection"
REFRESH = "app.services.page_service.refresh_from_confluence"
SYNC_TREE = "app.services.tree_sync.sync_project_tree"


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
    """Минимум интерфейса AsyncSession для джобы (как в test_projects)."""

    def __init__(self, execute_results=None, objects=None):
        self.execute_results = list(execute_results or [])
        self.objects = objects or {}
        self.added = []
        self.commits = 0

    async def execute(self, stmt):
        value = self.execute_results.pop(0) if self.execute_results else None
        return value if isinstance(value, FakeResult) else FakeResult(value)

    async def get(self, model, pk, options=None):
        return self.objects.get((model, pk))

    def add(self, obj):
        self.added.append(obj)
        self.objects[(type(obj), getattr(obj, "id", None))] = obj

    async def flush(self):
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()
                self.objects[(type(obj), obj.id)] = obj

    async def commit(self):
        self.commits += 1
        await self.flush()

    async def rollback(self):
        pass


class FakeSessionFactory:
    """`async with factory() as db` — все фазы прогона видят одну сессию."""

    def __init__(self, session):
        self.session = session

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *exc):
        return False


def make_project(name="Банк X"):
    project = Project(
        name=name,
        confluence_base_url="https://conf.bank-x.ru",
        created_by=uuid.uuid4(),
    )
    project.id = uuid.uuid4()
    project.is_demo = False
    return project


def make_cred(project, username="d.pechkin"):
    cred = ProjectCredential(
        project_id=project.id,
        user_id=uuid.uuid4(),
        confluence_username=username,
        confluence_password_enc=encrypt_secret("conf-pass"),
        status="ok",
    )
    cred.id = uuid.uuid4()
    return cred


def make_page(project, title="Требования"):
    page = Page(
        project_id=project.id,
        confluence_page_id="1001",
        confluence_url="https://conf.bank-x.ru/pages/viewpage.action?pageId=1001",
        title=title,
        space_key="SPC",
        added_by=uuid.uuid4(),
    )
    page.id = uuid.uuid4()
    page.is_virtual = False
    return page


UTC = timezone.utc


class StatusTransitionsTest(unittest.TestCase):
    def test_classification_for_journal(self):
        h = [uuid.uuid4() for _ in range(5)]
        before = {h[0]: "active", h[1]: "active", h[2]: "outdated", h[3]: "lost", h[4]: "outdated"}
        after = {h[0]: "outdated", h[1]: "lost", h[2]: "lost", h[3]: "lost", h[4]: "outdated"}
        to_outdated, to_lost = status_transitions(before, after)
        # В outdated — только из active; outdated, оставшийся outdated, не переход.
        self.assertEqual(to_outdated, [h[0]])
        # В lost — из active и outdated; lost, оставшийся lost, не переход.
        self.assertEqual(to_lost, [h[1], h[2]])


class ScheduleTest(unittest.TestCase):
    AT = "03:00"
    TZ = "Europe/Moscow"

    def test_not_due_before_local_time(self):
        # 23:30 UTC 15.07 = 02:30 МСК 16.07 — до 03:00, не пора.
        now = datetime(2026, 7, 15, 23, 30, tzinfo=UTC)
        self.assertFalse(is_run_due(now, at=self.AT, tz_name=self.TZ, last_start_utc=None))

    def test_due_after_local_time_without_runs(self):
        # 00:30 UTC = 03:30 МСК — пора, прогонов ещё не было.
        now = datetime(2026, 7, 16, 0, 30, tzinfo=UTC)
        self.assertTrue(is_run_due(now, at=self.AT, tz_name=self.TZ, last_start_utc=None))

    def test_not_due_when_run_started_today_local(self):
        # Прогон стартовал в 23:10 UTC 15.07 — это уже 02:10 МСК 16.07,
        # то есть СЕГОДНЯ по местному календарю: второй раз не запускаем.
        now = datetime(2026, 7, 16, 0, 30, tzinfo=UTC)
        last = datetime(2026, 7, 15, 23, 10, tzinfo=UTC)
        self.assertFalse(is_run_due(now, at=self.AT, tz_name=self.TZ, last_start_utc=last))

    def test_due_when_last_run_was_yesterday(self):
        now = datetime(2026, 7, 16, 0, 30, tzinfo=UTC)
        last = datetime(2026, 7, 15, 0, 30, tzinfo=UTC)  # 03:30 МСК 15.07
        self.assertTrue(is_run_due(now, at=self.AT, tz_name=self.TZ, last_start_utc=last))

    def test_catchup_later_in_the_day(self):
        # Сервер лежал в 03:00 и поднялся днём — прогон навёрстывается.
        now = datetime(2026, 7, 16, 11, 45, tzinfo=UTC)  # 14:45 МСК
        self.assertTrue(is_run_due(now, at=self.AT, tz_name=self.TZ, last_start_utc=None))

    def test_garbage_config_does_not_kill_scheduler(self):
        self.assertEqual(parse_hhmm("мусор"), dtime(3, 0))
        now = datetime(2026, 7, 16, 3, 30, tzinfo=UTC)
        # Неизвестная зона → UTC, «03:30 UTC ≥ 03:00» → пора.
        self.assertTrue(is_run_due(now, at="мусор", tz_name="Нет/Такой", last_start_utc=None))


class RunProjectBase(unittest.TestCase):
    def setUp(self):
        self._old_key = settings.CREDENTIALS_KEY
        settings.CREDENTIALS_KEY = Fernet.generate_key().decode()
        self._old_delay = settings.AUTO_REFRESH_PAGE_DELAY_MS
        settings.AUTO_REFRESH_PAGE_DELAY_MS = 0

        self.project = make_project()
        self.session = FakeSession()
        self.factory = FakeSessionFactory(self.session)

    def tearDown(self):
        settings.CREDENTIALS_KEY = self._old_key
        settings.AUTO_REFRESH_PAGE_DELAY_MS = self._old_delay

    def add_cred(self, **over):
        cred = make_cred(self.project, **over)
        self.session.objects[(ProjectCredential, cred.id)] = cred
        return cred

    def add_page(self, **over):
        page = make_page(self.project, **over)
        self.session.objects[(Page, page.id)] = page
        return page

    def run_job(self, **kwargs):
        return asyncio.run(run_project(self.factory, self.project, trigger="auto", **kwargs))

    def journal(self, run_id) -> RefreshRun:
        return self.session.objects[(RefreshRun, run_id)]


class RunProjectTest(RunProjectBase):
    def test_happy_path_journals_transitions_and_affected_tests(self):
        cred = self.add_cred()
        page = self.add_page()
        h1, h2 = uuid.uuid4(), uuid.uuid4()
        self.session.execute_results = [
            [cred],                                # ok-креды проекта
            [(page.id, page.title)],               # отслеживаемые страницы
            [(h1, "active"), (h2, "active")],      # статусы привязок до
            [(h1, "outdated"), (h2, "lost")],      # статусы после
            ["req-7", "REQ-7 ", "REQ-9"],          # ключи затронутых тестов
        ]
        with patch(CHECK_CONNECTION, new=AsyncMock()) as check, \
             patch(SYNC_TREE, new=AsyncMock(return_value=TreeSyncStats(spaces=1, added=2, moved=1))), \
             patch(REFRESH, new=AsyncMock(return_value=True)) as refresh:
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "ok")
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(run.trigger, "auto")
        self.assertEqual(
            (run.pages_total, run.pages_changed, run.pages_failed), (1, 1, 0))
        self.assertEqual((run.to_outdated, run.to_lost), (1, 1))
        self.assertEqual((run.tree_added, run.tree_moved), (2, 1))
        [entry] = run.details["pages"]
        self.assertEqual(entry["page_id"], str(page.id))
        self.assertTrue(entry["changed"])
        self.assertEqual(entry["to_outdated"], [str(h1)])
        self.assertEqual(entry["to_lost"], [str(h2)])
        # Ключи нормализованы (upper/trim), дубли слиты, порядок стабильный.
        self.assertEqual(entry["affected_tests"], ["REQ-7", "REQ-9"])
        self.assertIsNone(run.cred_issues)
        # Перепроверка кред оставила живую дату проверки в профиле.
        check.assert_awaited_once()
        self.assertEqual(cred.last_check_result, "ok")
        self.assertIsNotNone(cred.last_check_at)
        refresh.assert_awaited_once()

    def test_quiet_run_leaves_no_details(self):
        cred = self.add_cred()
        page = self.add_page()
        h1 = uuid.uuid4()
        self.session.execute_results = [
            [cred],
            [(page.id, page.title)],
            [(h1, "active")],
            [(h1, "active")],  # ничего не изменилось — ключи не запрашиваются
        ]
        with patch(CHECK_CONNECTION, new=AsyncMock()), \
             patch(SYNC_TREE, new=AsyncMock(return_value=TreeSyncStats())), \
             patch(REFRESH, new=AsyncMock(return_value=False)):
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "ok")
        self.assertEqual((run.pages_total, run.pages_changed), (1, 0))
        self.assertIsNone(run.details)
        self.assertIsNone(run.cred_issues)

    def test_no_credentials_skips_everything(self):
        self.session.execute_results = [[]]
        with patch(CHECK_CONNECTION, new=AsyncMock()) as check, \
             patch(SYNC_TREE, new=AsyncMock()) as sync, \
             patch(REFRESH, new=AsyncMock()) as refresh:
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "skipped")
        self.assertEqual(run.details["skipped_reason"], "no_credentials")
        self.assertEqual(run.pages_total, 0)
        check.assert_not_awaited()
        sync.assert_not_awaited()
        refresh.assert_not_awaited()

    def test_rejected_creds_marked_invalid_with_issue(self):
        cred = self.add_cred()
        self.session.execute_results = [[cred]]
        with patch(CHECK_CONNECTION, new=AsyncMock(side_effect=ConfluenceAuthError(401))), \
             patch(SYNC_TREE, new=AsyncMock()) as sync, \
             patch(REFRESH, new=AsyncMock()) as refresh:
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "skipped")
        self.assertEqual(run.details["skipped_reason"], "no_valid_credentials")
        self.assertEqual(cred.status, "invalid")
        self.assertEqual(cred.last_check_result, "invalid")
        self.assertEqual(run.cred_issues, [{
            "user_id": str(cred.user_id),
            "username": "d.pechkin",
            "result": "invalid",
        }])
        sync.assert_not_awaited()
        refresh.assert_not_awaited()

    def test_unreachable_confluence_postpones_without_breaking_creds(self):
        cred = self.add_cred()
        self.session.execute_results = [[cred]]
        with patch(CHECK_CONNECTION, new=AsyncMock(side_effect=Exception("timeout"))), \
             patch(SYNC_TREE, new=AsyncMock()) as sync, \
             patch(REFRESH, new=AsyncMock()) as refresh:
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "skipped")
        self.assertEqual(run.details["skipped_reason"], "confluence_unreachable")
        # Недоступность — не вина кред: статус ok сохранён, исход зафиксирован.
        self.assertEqual(cred.status, "ok")
        self.assertEqual(cred.last_check_result, "unreachable")
        self.assertIsNone(run.cred_issues)
        sync.assert_not_awaited()
        refresh.assert_not_awaited()

    def test_midrun_auth_failure_switches_member_and_retries_page(self):
        cred1 = self.add_cred(username="first")
        cred2 = self.add_cred(username="second")
        page = self.add_page()
        h1 = uuid.uuid4()
        self.session.execute_results = [
            [cred1, cred2],
            [(page.id, page.title)],
            [(h1, "active")],  # «до» первой попытки (упадёт на fetch)
            [(h1, "active")],  # «до» повторной попытки вторыми кредами
            [(h1, "active")],  # «после» — без переходов
        ]
        with patch(CHECK_CONNECTION, new=AsyncMock()), \
             patch(SYNC_TREE, new=AsyncMock(return_value=TreeSyncStats())), \
             patch(REFRESH, new=AsyncMock(side_effect=[
                 HTTPException(status_code=403, detail="Confluence отклонил ваши логин/пароль"),
                 True,
             ])) as refresh:
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "ok")
        self.assertEqual((run.pages_total, run.pages_changed, run.pages_failed), (1, 1, 0))
        self.assertEqual(run.cred_issues, [{
            "user_id": str(cred1.user_id), "username": "first", "result": "invalid",
        }])
        self.assertEqual(refresh.await_count, 2)
        # Повтор — уже вторым участником.
        self.assertIs(refresh.await_args.args[3], cred2)

    def test_exhausted_credentials_stop_run_as_partial(self):
        cred = self.add_cred()
        p1 = self.add_page(title="А")
        p2 = self.add_page(title="Б")
        h1 = uuid.uuid4()
        self.session.execute_results = [
            [cred],
            [(p1.id, p1.title), (p2.id, p2.title)],
            [(h1, "active")],  # «до» первой страницы; refresh упадёт
        ]
        with patch(CHECK_CONNECTION, new=AsyncMock()), \
             patch(SYNC_TREE, new=AsyncMock(return_value=TreeSyncStats())), \
             patch(REFRESH, new=AsyncMock(side_effect=HTTPException(status_code=403, detail="x"))):
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "partial")
        self.assertEqual(run.details["skipped_reason"], "no_valid_credentials")
        self.assertEqual(run.pages_total, 2)
        self.assertEqual(run.pages_changed, 0)
        self.assertEqual(len(run.cred_issues), 1)

    def test_network_death_midrun_stops_run_as_unreachable(self):
        """Связь оборвалась посреди прогона: контрольный пинг падает —
        оставшиеся страницы не перебираются (каждая ждала бы таймаут),
        прогон уходит в skipped/unreachable, его дотянет почасовой добор."""
        cred = self.add_cred()
        p1 = self.add_page(title="А")
        p2 = self.add_page(title="Б")
        h1 = uuid.uuid4()
        self.session.execute_results = [
            [cred],
            [(p1.id, p1.title), (p2.id, p2.title)],
            [(h1, "active")],  # «до» p1; fetch умрёт по сети
        ]
        with patch(CHECK_CONNECTION, new=AsyncMock(
                 side_effect=[None, Exception("сеть умерла")])), \
             patch(SYNC_TREE, new=AsyncMock(return_value=TreeSyncStats())), \
             patch(REFRESH, new=AsyncMock(side_effect=HTTPException(
                 status_code=502, detail="Failed to fetch from Confluence: timeout"))) as refresh:
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "skipped")
        self.assertEqual(run.details["skipped_reason"], "confluence_unreachable")
        self.assertEqual(run.pages_failed, 1)
        # Ко второй странице не ходили.
        refresh.assert_awaited_once()
        # Креды не тронуты: сеть — не их вина.
        self.assertEqual(cred.status, "ok")

    def test_single_page_error_does_not_break_the_run(self):
        cred = self.add_cred()
        p1 = self.add_page(title="А")
        p2 = self.add_page(title="Б")
        h1, h2 = uuid.uuid4(), uuid.uuid4()
        self.session.execute_results = [
            [cred],
            [(p1.id, p1.title), (p2.id, p2.title)],
            [(h1, "active")],  # «до» p1; refresh вернёт 502
            [(h2, "active")],  # «до» p2
            [(h2, "active")],  # «после» p2
        ]
        with patch(CHECK_CONNECTION, new=AsyncMock()), \
             patch(SYNC_TREE, new=AsyncMock(return_value=TreeSyncStats())), \
             patch(REFRESH, new=AsyncMock(side_effect=[
                 HTTPException(status_code=502, detail="Failed to fetch from Confluence: boom"),
                 True,
             ])):
            run_id = self.run_job()

        run = self.journal(run_id)
        self.assertEqual(run.status, "partial")
        self.assertEqual((run.pages_total, run.pages_changed, run.pages_failed), (2, 1, 1))
        failed_entry, changed_entry = run.details["pages"]
        self.assertEqual(failed_entry["page_id"], str(p1.id))
        self.assertIn("boom", failed_entry["error"])
        self.assertEqual(changed_entry["page_id"], str(p2.id))
        self.assertTrue(changed_entry["changed"])
        # Ошибка одной страницы — не повод трогать креды.
        self.assertIsNone(run.cred_issues)


class PreferUserCredsTest(RunProjectBase):
    def test_manual_run_tries_initiator_credentials_first(self):
        cred1 = self.add_cred(username="colleague")
        cred2 = self.add_cred(username="initiator")
        page = self.add_page()
        h1 = uuid.uuid4()
        self.session.execute_results = [
            [cred1, cred2],           # порядок «по свежести чека»
            [(page.id, page.title)],
            [(h1, "active")],
            [(h1, "active")],
        ]
        with patch(CHECK_CONNECTION, new=AsyncMock()), \
             patch(SYNC_TREE, new=AsyncMock(return_value=TreeSyncStats())), \
             patch(REFRESH, new=AsyncMock(return_value=False)) as refresh:
            self.run_job(prefer_user_id=cred2.user_id)

        # Ручной прогон идёт кредами инициатора, хотя в списке он был вторым.
        self.assertIs(refresh.await_args.args[3], cred2)


class PickRetryProjectsTest(unittest.TestCase):
    """Самолечебный добор (v1.6.4): кого пробовать ещё раз."""

    NOW = datetime(2026, 7, 16, 9, 0, tzinfo=UTC)

    def rows(self, *attempts):
        return list(attempts)

    def test_failed_project_with_stale_attempt_is_retried(self):
        pid = uuid.uuid4()
        rows = [(pid, "skipped", self.NOW - timedelta(hours=6), self.NOW - timedelta(hours=6))]
        self.assertEqual(pick_retry_projects(rows, self.NOW), [pid])

    def test_successful_today_is_left_alone(self):
        pid = uuid.uuid4()
        rows = [
            (pid, "skipped", self.NOW - timedelta(hours=6), self.NOW - timedelta(hours=6)),
            (pid, "ok", self.NOW - timedelta(hours=2), self.NOW - timedelta(hours=2)),
        ]
        self.assertEqual(pick_retry_projects(rows, self.NOW), [])

    def test_partial_counts_as_success(self):
        # partial = данные добыты (часть страниц упала) — почасовой добор
        # не молотит проект, у которого просто битые страницы.
        pid = uuid.uuid4()
        rows = [(pid, "partial", self.NOW - timedelta(hours=3), self.NOW - timedelta(hours=3))]
        self.assertEqual(pick_retry_projects(rows, self.NOW), [])

    def test_recent_attempt_waits_its_hour(self):
        pid = uuid.uuid4()
        rows = [(pid, "skipped", self.NOW - timedelta(minutes=20), self.NOW - timedelta(minutes=20))]
        self.assertEqual(pick_retry_projects(rows, self.NOW), [])

    def test_crashed_unfinished_run_retried_after_pause(self):
        # Строка без finished_at (процесс умер): статус по умолчанию skipped,
        # успешной её считать нельзя — добор через час после старта.
        pid = uuid.uuid4()
        rows = [(pid, "skipped", self.NOW - timedelta(hours=2), None)]
        self.assertEqual(pick_retry_projects(rows, self.NOW), [pid])

    def test_project_without_attempts_is_main_sweep_business(self):
        self.assertEqual(pick_retry_projects([], self.NOW), [])


class RunSweepTest(unittest.TestCase):
    def test_project_failure_does_not_stop_others(self):
        p1, p2 = make_project("А"), make_project("Б")
        session = FakeSession(execute_results=[[p1, p2]])
        factory = FakeSessionFactory(session)
        with patch(
            "app.jobs.nightly.run_project",
            new=AsyncMock(side_effect=[RuntimeError("boom"), uuid.uuid4()]),
        ) as rp:
            count = asyncio.run(run_sweep(trigger="auto", session_factory=factory))
        self.assertEqual(count, 2)
        self.assertEqual(rp.await_count, 2)

    def test_sweep_prunes_journal_and_survives_prune_failure(self):
        session = FakeSession(execute_results=[[]])
        factory = FakeSessionFactory(session)
        with patch(
            "app.jobs.nightly.prune_journal",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ) as prune:
            count = asyncio.run(run_sweep(trigger="auto", session_factory=factory))
        # Чистка вызвана раз за обход; её падение обход не валит.
        self.assertEqual(prune.await_count, 1)
        self.assertEqual(count, 0)


class PruneJournalTest(unittest.TestCase):
    """Ретеншн журнала (v1.6.5): строки старше окна уходят раз в ночной обход."""

    NOW = datetime(2026, 7, 19, 0, 12, tzinfo=timezone.utc)

    def test_deletes_finished_and_dead_rows_older_than_retention(self):
        statements = []

        class RecordingSession(FakeSession):
            async def execute(self, stmt):
                statements.append(stmt)
                return await super().execute(stmt)

        deleted_result = FakeResult(None)
        deleted_result.rowcount = 3
        session = RecordingSession(execute_results=[deleted_result])

        deleted = asyncio.run(
            prune_journal(FakeSessionFactory(session), now_utc=self.NOW)
        )

        self.assertEqual(deleted, 3)
        self.assertEqual(session.commits, 1)
        [stmt] = statements
        # Оба условия — завершённые и мёртвые незавершённые — режутся по
        # одному порогу: NOW − 90 дней.
        params = stmt.compile().params
        cutoff = self.NOW - timedelta(days=90)
        self.assertEqual(len(params), 2)
        self.assertTrue(all(v == cutoff for v in params.values()), params)


if __name__ == "__main__":
    unittest.main()
