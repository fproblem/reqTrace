"""Ночной прогон автообновления (v1.6.2, план — auto-refresh-plan-v1.6.md).

Обходит все обычные проекты и по каждому: перепроверяет ok-креды участников
(живой last_check_at в профиле), сверяет дерево (tree_sync) и прогоняет
refresh всех отслеживаемых страниц рабочими кредами. Правила статусов
привязок здесь НЕ живут — их решает anchoring.project внутри обычного
refresh-конвейера; джоба лишь считает переходы «до → после» и журналирует
итоги в refresh_runs (источник утреннего дайджеста, v1.6.3).

Аккуратность с кредами:
  • invalid-креды не перепроверяются — ночные ретраи basic-auth с заведомо
    сменившимся паролем рискуют блокировкой учётки в LDAP; чинит человек;
  • 401/403 посреди прогона: подключение помечает invalid сам refresh-конвейер
    (run_confluence), джоба фиксирует проблему, переключается на следующего
    участника и повторяет страницу; участники кончились → прогон прерван;
  • Confluence недоступен целиком (VPN/сеть) → прогон проекта переносится
    на следующую ночь, статусы и доступ никто не трогает.

Сессии БД: короткая на каждую фазу и на каждую страницу — упавшая страница
откатывает только себя и не путает состояние остальных.

Запуск руками: docker compose run backend python -m app.jobs.nightly
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, delete, or_, select

from app.config import settings
from app.database import async_session
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.refresh_run import RefreshRun
from app.project_access import connection_for
from app.services import confluence, page_service, tree_sync
from app.services.confluence import ConfluenceAuthError

logger = logging.getLogger(__name__)

# Ретеншн журнала (v1.6.5): дальше всех в прошлое смотрит панель уведомлений
# (14 дней) — 90 дней дают шестикратный запас и квартальную историю, а рост
# таблицы (и её JSONB-подробностей) перестаёт быть бесконечным.
JOURNAL_RETENTION_DAYS = 90


async def prune_journal(
    session_factory=async_session,
    *,
    now_utc: datetime | None = None,
    retention_days: int = JOURNAL_RETENTION_DAYS,
) -> int:
    """Удаляет строки журнала старше окна ретеншна; возвращает их число.

    Уходят завершённые прогоны старше порога и «мёртвые» незавершённые
    (строка без finished_at старше порога — процесс давно погиб, индикатор
    такие и при жизни не показывал). Вызывается из ночного обхода; его
    падение прогона не задевает (см. run_sweep).
    """
    now_utc = now_utc or datetime.now(timezone.utc)
    cutoff = now_utc - timedelta(days=retention_days)
    async with session_factory() as db:
        result = await db.execute(
            delete(RefreshRun).where(or_(
                RefreshRun.finished_at < cutoff,
                and_(RefreshRun.finished_at.is_(None), RefreshRun.started_at < cutoff),
            ))
        )
        await db.commit()
    deleted = getattr(result, "rowcount", 0) or 0
    if deleted:
        logger.info("auto-refresh: журнал подчищен — удалено %d строк старше %d дней",
                    deleted, retention_days)
    return deleted


def pick_retry_projects(rows, now_utc: datetime, retry_after_minutes: int = 60) -> list:
    """Проекты для самолечебного добора (v1.6.4).

    rows — (project_id, status, started_at, finished_at) за СЕГОДНЯШНИЙ
    локальный день. Добираем проект, если попытки за сегодня были, ни одна
    не успешна (ok/partial с finished_at), а последняя — старше
    retry_after_minutes (свежая, возможно, ещё идёт; лок и так не пустит).
    Проекты вовсе без попыток — забота основного суточного прогона.
    """
    by_project: dict = {}
    for project_id, status, started_at, finished_at in rows:
        by_project.setdefault(project_id, []).append((status, started_at, finished_at))

    result = []
    for project_id, attempts in by_project.items():
        if any(s in ("ok", "partial") and f is not None for s, _, f in attempts):
            continue
        starts = [st for _, st, _ in attempts if st is not None]
        if starts and now_utc - max(starts) < timedelta(minutes=retry_after_minutes):
            continue
        result.append(project_id)
    return result


def status_transitions(before: dict, after: dict) -> tuple[list, list]:
    """Переходы статусов привязок за refresh (id → status до/после).

    Правила переходов живут в anchoring.project; здесь только классификация
    для журнала: в outdated привязка попадает лишь из active (новые привязки
    во время прогона не появляются), в lost — из active и outdated.
    """
    to_outdated = [h for h, s in after.items() if s == "outdated" and before.get(h) == "active"]
    to_lost = [h for h, s in after.items() if s == "lost" and before.get(h) in ("active", "outdated")]
    return to_outdated, to_lost


async def _page_statuses(db, page_id) -> dict:
    rows = (await db.execute(
        select(Highlight.id, Highlight.status).where(Highlight.page_id == page_id)
    )).all()
    return {h: s for h, s in rows}


async def _affected_test_keys(db, highlight_ids: list) -> list[str]:
    """Ключи тестов, привязанных к перешедшим привязкам, — фиксируются в
    журнале в момент прогона (нормализация — как в /projects: upper/trim)."""
    if not highlight_ids:
        return []
    rows = (await db.execute(
        select(HighlightTest.test_key).where(HighlightTest.highlight_id.in_(highlight_ids))
    )).scalars().all()
    return sorted({(k or "").strip().upper() for k in rows if k})


def _cred_issue(cred: ProjectCredential) -> dict:
    return {
        "user_id": str(cred.user_id),
        "username": cred.confluence_username,
        "result": "invalid",
    }


async def _recheck_credentials(
    db, project: Project, creds: list[ProjectCredential]
) -> tuple[list[ProjectCredential], list[dict], bool]:
    """Живая перепроверка ok-кред участников (шаг 1 прогона).

    Обновляет last_check_at/last_check_result у всех проверенных — дата
    проверки в профиле остаётся живой без ручных действий. Возвращает
    (рабочие креды, проблемы для журнала, был ли Confluence недоступен).
    Каждая пометка коммитится сразу — как mark_invalid в project_access.
    """
    usable: list[ProjectCredential] = []
    issues: list[dict] = []
    unreachable = False

    for cred in creds:
        try:
            conn = connection_for(project, cred)
        except HTTPException:
            # Пароль не читается (сменился CREDENTIALS_KEY) — перезаписать
            # креды может только сам участник; ночью просто пропускаем.
            logger.warning(
                "nightly: пароль %s в проекте «%s» не расшифровывается — пропуск",
                cred.confluence_username, project.name,
            )
            continue

        cred.last_check_at = datetime.now(timezone.utc)
        try:
            await confluence.check_connection(conn)
        except ConfluenceAuthError:
            cred.status = "invalid"
            cred.last_check_result = "invalid"
            issues.append(_cred_issue(cred))
            await db.commit()
            continue
        except Exception as e:
            logger.warning(
                "nightly: Confluence %s недоступен (%s): %s",
                project.confluence_base_url, cred.confluence_username, e,
            )
            cred.last_check_result = "unreachable"
            unreachable = True
            await db.commit()
            continue

        cred.last_check_result = "ok"
        await db.commit()
        usable.append(cred)

    return usable, issues, unreachable


async def _confluence_alive(project: Project, cred: ProjectCredential) -> bool:
    """Контрольный пинг после неудачи страницы: жив ли Confluence целиком.

    Отличает «умерла сеть/VPN посреди прогона» (перебирать оставшиеся страницы
    бессмысленно — каждая умрёт по таймауту) от проблемы конкретной страницы
    (удалена, битый контент — едем дальше). Отказ кред и нечитаемый пароль —
    это НЕ «сеть умерла»: сервер отвечает.
    """
    try:
        await confluence.check_connection(connection_for(project, cred))
        return True
    except ConfluenceAuthError:
        return True
    except HTTPException:
        return True
    except Exception:
        return False


async def _refresh_one_page(session_factory, project: Project, cred_id, page_id) -> dict:
    """Refresh одной страницы в собственной сессии.

    Возвращает {"changed", "to_outdated", "to_lost", "affected_tests"} при
    успехе, {"error", "auth_failed"} при ошибке. Сессия без commit закрывается
    откатом — неудачная страница не оставляет следов.
    """
    async with session_factory() as db:
        page = await db.get(Page, page_id)
        cred = await db.get(ProjectCredential, cred_id)
        if page is None or cred is None:
            return {"error": "страница или креды исчезли во время прогона", "auth_failed": False}

        before = await _page_statuses(db, page_id)
        try:
            changed = await page_service.refresh_from_confluence(db, page, project, cred)
        except HTTPException as e:
            # 403 — Confluence отклонил креды: подключение уже помечено invalid
            # (run_confluence, с собственным commit); вызывающий сменит участника.
            return {"error": str(e.detail), "auth_failed": e.status_code == 403}
        except Exception as e:  # неожиданный сбой — журналируем и едем дальше
            logger.exception("nightly: refresh страницы %s упал", page_id)
            return {"error": str(e), "auth_failed": False}

        after = await _page_statuses(db, page_id)
        to_outdated, to_lost = status_transitions(before, after)
        affected_tests = await _affected_test_keys(db, to_outdated + to_lost)
        await db.commit()
        return {
            "changed": changed,
            "to_outdated": to_outdated,
            "to_lost": to_lost,
            "affected_tests": affected_tests,
        }


async def run_project(
    session_factory, project: Project, *, trigger: str, prefer_user_id=None
) -> uuid.UUID:
    """Прогон одного проекта: креды → sync-tree → refresh страниц; журналирует.

    prefer_user_id — чьи креды пробовать первыми: ручной прогон (v1.6.4) идёт
    от имени нажавшего — он дал согласие кликом. Возвращает id строки журнала.
    Строка создаётся сразу (маркер «прогон идёт»); смерть процесса оставит её
    без finished_at — честный след.
    """
    async with session_factory() as db:
        run = RefreshRun(project_id=project.id, trigger=trigger)
        db.add(run)
        await db.commit()
        run_id = run.id

    pages_total = pages_changed = pages_failed = 0
    to_outdated_total = to_lost_total = 0
    details_pages: list[dict] = []
    issues: list[dict] = []
    tree = tree_sync.TreeSyncStats()
    skipped_reason: str | None = None
    stopped_early = False
    usable: list[ProjectCredential] = []

    # Шаг 1: перепроверка кред. Свежепроверенные первыми — при равенстве
    # порядок стабилен и предсказуем.
    async with session_factory() as db:
        creds = list((await db.execute(
            select(ProjectCredential)
            .where(
                ProjectCredential.project_id == project.id,
                ProjectCredential.status == "ok",
            )
            .order_by(ProjectCredential.last_check_at.desc().nulls_last())
        )).scalars().all())
        if prefer_user_id is not None:
            # Стабильная сортировка: инициатор первым, порядок остальных цел.
            creds.sort(key=lambda c: c.user_id != prefer_user_id)

        if not creds:
            skipped_reason = "no_credentials"
        else:
            usable, issues, unreachable = await _recheck_credentials(db, project, creds)
            if not usable:
                skipped_reason = "confluence_unreachable" if unreachable else "no_valid_credentials"

    # Шаг 2: сверка дерева рабочими кредами (новые/перемещённые страницы).
    if skipped_reason is None:
        async with session_factory() as db:
            while usable:
                cred = usable[0]
                fresh_cred = await db.get(ProjectCredential, cred.id)
                if fresh_cred is None:
                    usable.pop(0)
                    continue
                stats = await tree_sync.sync_project_tree(
                    db, project, connection_for(project, fresh_cred), fresh_cred.user_id
                )
                tree.spaces += stats.spaces
                tree.moved += stats.moved
                tree.added += stats.added
                tree.removed += stats.removed
                tree.missing_tracked += stats.missing_tracked
                await db.commit()
                if not stats.auth_failed:
                    break
                # Отказ сразу после успешной проверки — экзотика, но обрабатываем:
                # помечаем, фиксируем и пробуем следующего участника.
                fresh_cred.status = "invalid"
                fresh_cred.last_check_at = datetime.now(timezone.utc)
                fresh_cred.last_check_result = "invalid"
                issues.append(_cred_issue(fresh_cred))
                await db.commit()
                usable.pop(0)
            if not usable:
                # Все участники выбыли ещё на сверке дерева.
                skipped_reason = "no_valid_credentials"

    # Шаг 3: refresh отслеживаемых страниц.
    if skipped_reason is None and usable:
        async with session_factory() as db:
            page_rows = (await db.execute(
                select(Page.id, Page.title)
                .where(
                    Page.project_id == project.id,
                    Page.is_virtual == False,  # noqa: E712
                )
                .order_by(Page.title)
            )).all()
        pages_total = len(page_rows)
        delay = max(settings.AUTO_REFRESH_PAGE_DELAY_MS, 0) / 1000

        for i, (page_id, page_title) in enumerate(page_rows):
            if i and delay:
                await asyncio.sleep(delay)

            result = None
            while usable:
                cred = usable[0]
                result = await _refresh_one_page(session_factory, project, cred.id, page_id)
                if result.get("auth_failed"):
                    issues.append(_cred_issue(cred))
                    usable.pop(0)
                    result = None
                    continue
                break

            if result is None:
                # Рабочие подключения кончились посреди прогона.
                skipped_reason = "no_valid_credentials"
                stopped_early = True
                break

            if "error" in result:
                pages_failed += 1
                details_pages.append({
                    "page_id": str(page_id), "title": page_title, "error": result["error"],
                })
                # Сеть могла умереть посреди прогона: контрольный пинг — если
                # Confluence недоступен целиком, оставшиеся страницы перебирать
                # бессмысленно (каждая ждала бы таймаут). Прерываемся как
                # unreachable — почасовой добор попробует, когда связь вернётся.
                if not await _confluence_alive(project, usable[0]):
                    logger.warning(
                        "nightly: «%s» — Confluence стал недоступен посреди прогона, прерываюсь",
                        project.name,
                    )
                    skipped_reason = "confluence_unreachable"
                    stopped_early = True
                    break
                continue

            if result["changed"]:
                pages_changed += 1
            to_outdated_total += len(result["to_outdated"])
            to_lost_total += len(result["to_lost"])
            # В details — только страницы, о которых есть что сказать.
            if result["changed"] or result["to_outdated"] or result["to_lost"]:
                details_pages.append({
                    "page_id": str(page_id),
                    "title": page_title,
                    "changed": result["changed"],
                    "to_outdated": [str(h) for h in result["to_outdated"]],
                    "to_lost": [str(h) for h in result["to_lost"]],
                    "affected_tests": result["affected_tests"],
                })

    if skipped_reason == "confluence_unreachable":
        # Сеть умерла (до или посреди прогона): «сделанным на сегодня» прогон
        # не считается — почасовой добор попробует ещё раз. Найденные до
        # обрыва переходы уже в журнале, дайджест их не потеряет.
        status = "skipped"
    elif stopped_early:
        status = "partial"
    elif skipped_reason:
        status = "skipped"
    elif pages_failed:
        status = "partial"
    else:
        status = "ok"

    async with session_factory() as db:
        run = await db.get(RefreshRun, run_id)
        if run is not None:
            run.status = status
            run.finished_at = datetime.now(timezone.utc)
            run.pages_total = pages_total
            run.pages_changed = pages_changed
            run.pages_failed = pages_failed
            run.to_outdated = to_outdated_total
            run.to_lost = to_lost_total
            run.tree_added = tree.added
            run.tree_moved = tree.moved
            run.tree_removed = tree.removed
            run.tree_missing_tracked = tree.missing_tracked
            details: dict = {}
            if details_pages:
                details["pages"] = details_pages
            if skipped_reason:
                details["skipped_reason"] = skipped_reason
            run.details = details or None
            run.cred_issues = issues or None
            await db.commit()

    logger.info(
        "nightly: «%s» — %s (страниц %d, изменилось %d, ошибок %d; → проверить %d, → утрачено %d)",
        project.name, status, pages_total, pages_changed, pages_failed,
        to_outdated_total, to_lost_total,
    )
    return run_id


async def run_sweep(*, trigger: str = "auto", session_factory=async_session) -> int:
    """Обход всех обычных проектов; возвращает их число.

    Падение прогона одного проекта не трогает остальные: его строка журнала
    останется без finished_at (честный след), обход продолжится.
    """
    async with session_factory() as db:
        projects = list((await db.execute(
            select(Project).where(Project.is_demo == False).order_by(Project.name)  # noqa: E712
        )).scalars().all())

    logger.info("auto-refresh: обход %d проектов (%s)", len(projects), trigger)
    for project in projects:
        try:
            await run_project(session_factory, project, trigger=trigger)
        except Exception:
            logger.exception("auto-refresh: прогон проекта «%s» упал", project.name)

    # Гигиена журнала — раз в обход, после всех проектов; неудача чистки
    # не должна портить сам прогон.
    try:
        await prune_journal(session_factory)
    except Exception:
        logger.exception("auto-refresh: чистка журнала упала")
    return len(projects)


async def run_projects(project_ids, *, trigger: str, session_factory=async_session) -> int:
    """Прогон конкретных проектов (самолечебный добор v1.6.4) — с той же
    изоляцией ошибок, что у run_sweep."""
    ids = list(project_ids)
    if not ids:
        return 0
    async with session_factory() as db:
        projects = list((await db.execute(
            select(Project)
            .where(Project.id.in_(ids), Project.is_demo == False)  # noqa: E712
            .order_by(Project.name)
        )).scalars().all())

    for project in projects:
        try:
            await run_project(session_factory, project, trigger=trigger)
        except Exception:
            logger.exception("auto-refresh: добор проекта «%s» упал", project.name)
    return len(projects)


async def _cli() -> None:
    logging.basicConfig(level=logging.INFO)
    from app.jobs.scheduler import run_sweep_locked

    if not await run_sweep_locked(trigger="cli"):
        raise SystemExit("Прогон уже идёт в другом процессе — advisory-lock занят")


if __name__ == "__main__":
    asyncio.run(_cli())
