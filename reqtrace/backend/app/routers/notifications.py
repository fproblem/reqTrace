"""Уведомления и утренний дайджест (v1.6.3, план — auto-refresh-plan-v1.6.md §3.4).

Уведомление — ПРЕДСТАВЛЕНИЕ журнала refresh_runs, а не рассылка: выборка
строится от членств текущего пользователя, fan-out'а нет — «отправить
лишнему» невозможно по построению. Дайджесты прогонов видны участникам с
рабочим подключением (та же граница, что у контента проекта); личная запись
«ваши креды отклонены» — по самому факту членства: у пользователя с только
что протухшим паролем статус уже invalid, и по правилу «ok» он не увидел бы
главное для себя уведомление.

Тихие прогоны (без переходов, потерь и ошибок) в панель не попадают — «нет
бейджа» само по себе означает «требования не менялись». Их след остаётся
в журнале и в строке свежести на карточках «Тестов».
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models.project import Project, ProjectCredential
from app.models.refresh_run import RefreshRun
from app.models.user import User
from app.schemas.notification import NotificationEntry, NotificationsResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

WINDOW_DAYS = 14   # старше — не новости; журнал остаётся полным
MAX_ENTRIES = 50
# Причины «не выполнено», о которых стоит говорить; no_credentials скрыт:
# без единого рабочего подключения проект не виден никому.
SHOWN_SKIP_REASONS = ("confluence_unreachable", "no_valid_credentials")


def _skip_reason(run: RefreshRun) -> str | None:
    return (run.details or {}).get("skipped_reason")


def _is_shown_skip(run: RefreshRun) -> bool:
    return run.status == "skipped" and _skip_reason(run) in SHOWN_SKIP_REASONS


def failure_unseen_marker(finished_desc: list[datetime], today_local, tz) -> datetime:
    """Момент, с которого состояние «не выполняется» считается непрочитанным.

    finished_desc — времена попыток серии, от свежих к старым. Бейдж
    напоминает о продолжающейся проблеме РАЗ В ДЕНЬ (первая попытка
    сегодняшнего локального дня), а не каждый почасовой добор; серия без
    сегодняшних попыток считается от своего начала.
    """
    todays = [t for t in finished_desc if t.astimezone(tz).date() == today_local]
    return min(todays) if todays else finished_desc[-1]


def _event_entries(
    run: RefreshRun, project_name: str, user_id, digest_visible: bool
) -> list[NotificationEntry]:
    """СОБЫТИЙНЫЕ записи одной строки журнала: дайджест изменений и личная
    «ваши креды отклонены». «Не выполнено» здесь нет — это состояние проекта,
    его строит _failure_state_entry по хвостовой серии неудач."""
    entries: list[NotificationEntry] = []
    details = run.details or {}
    base = {
        "project_id": run.project_id,
        "project_name": project_name,
        "happened_at": run.finished_at,
    }

    # Личная запись о моих кредах — по членству, независимо от его статуса.
    for issue in run.cred_issues or []:
        if issue.get("user_id") == str(user_id):
            entries.append(NotificationEntry(id=f"{run.id}:cred", kind="cred_invalid", **base))
            break

    if not digest_visible:
        return entries

    # Значимость дайджеста — переходы, потери, ошибки страниц (план §3.4);
    # изменившиеся страницы без задетых привязок — кандидат v1.6.5+.
    # Дайджест строится и у skipped-прогона: связь могла оборваться ПОСРЕДИ
    # (v1.6.4) — переходы уже применены к привязкам, добор их «не увидит»,
    # и кроме этой строки журнала о них не расскажет никто.
    if not (run.to_outdated or run.to_lost or run.pages_failed):
        return entries

    affected = sorted({
        key
        for page in details.get("pages", [])
        for key in page.get("affected_tests", [])
    })
    entries.append(NotificationEntry(
        id=f"{run.id}:digest", kind="digest",
        pages_total=run.pages_total,
        pages_changed=run.pages_changed,
        pages_failed=run.pages_failed,
        to_outdated=run.to_outdated,
        to_lost=run.to_lost,
        affected_tests=affected,
        skipped_reason=_skip_reason(run),
        **base,
    ))
    return entries


def _failure_state_entry(
    runs_desc: list[RefreshRun], project_name: str
) -> NotificationEntry | None:
    """СОСТОЯНИЕ «проект сейчас не обновляется» — одна живая строка на проект.

    Хвостовая серия неудачных прогонов (свежие первыми) схлопывается в одну
    запись с числом попыток; первый же успешный прогон разрывает серию — и
    строка исчезает вовсе (новости расскажет его дайджест). Иначе почасовое
    самолечение (v1.6.4) завалило бы панель одинаковыми «не выполнено» и
    утопило главное — сообщения об изменениях страниц.
    """
    streak: list[RefreshRun] = []
    for run in runs_desc:
        if _is_shown_skip(run):
            streak.append(run)
        else:
            break
    if not streak:
        return None
    last, first = streak[0], streak[-1]
    return NotificationEntry(
        id=f"{last.id}:skip", kind="run_skipped",
        project_id=last.project_id,
        project_name=project_name,
        happened_at=last.finished_at,
        first_attempt_at=first.finished_at,
        attempts=len(streak),
        skipped_reason=_skip_reason(last),
    )


@router.get("", response_model=NotificationsResponse)
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Панель уведомлений: дайджесты ночных прогонов моих проектов."""
    creds_result = await db.execute(
        select(ProjectCredential).where(ProjectCredential.user_id == current_user.id)
    )
    my_creds = list(creds_result.scalars().all())
    member_ids = [c.project_id for c in my_creds]
    if not member_ids:
        return NotificationsResponse(unseen_count=0, entries=[])
    ok_ids = {c.project_id for c in my_creds if c.status == "ok"}

    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    runs_result = await db.execute(
        select(RefreshRun, Project.name)
        .join(Project, Project.id == RefreshRun.project_id)
        .where(
            RefreshRun.project_id.in_(member_ids),
            RefreshRun.finished_at.isnot(None),
            RefreshRun.finished_at >= since,
        )
        .order_by(RefreshRun.finished_at.desc())
    )

    runs_by_project: dict = {}
    names: dict = {}
    for run, project_name in runs_result.all():
        runs_by_project.setdefault(run.project_id, []).append(run)
        names[run.project_id] = project_name

    try:
        tz = ZoneInfo(settings.AUTO_REFRESH_TZ)
    except Exception:
        tz = timezone.utc
    today_local = datetime.now(timezone.utc).astimezone(tz).date()

    entries: list[NotificationEntry] = []
    # У состояния «не выполняется» свой момент непрочитанности (раз в день),
    # у событий — их собственное время.
    unseen_markers: dict[str, datetime] = {}

    for project_id, project_runs in runs_by_project.items():
        project_runs.sort(key=lambda r: r.finished_at, reverse=True)
        digest_visible = project_id in ok_ids
        for run in project_runs:
            entries.extend(_event_entries(
                run, names[project_id], current_user.id, digest_visible,
            ))
        if digest_visible:
            state = _failure_state_entry(project_runs, names[project_id])
            if state is not None:
                entries.append(state)
                unseen_markers[state.id] = failure_unseen_marker(
                    [r.finished_at for r in project_runs[:state.attempts]],
                    today_local, tz,
                )

    entries.sort(key=lambda e: e.happened_at, reverse=True)
    entries = entries[:MAX_ENTRIES]

    seen_at = current_user.notifications_seen_at
    for entry in entries:
        marker = unseen_markers.get(entry.id, entry.happened_at)
        entry.unseen = seen_at is None or marker > seen_at

    return NotificationsResponse(
        unseen_count=sum(1 for e in entries if e.unseen),
        entries=entries,
    )


@router.post("/seen", status_code=204)
async def mark_notifications_seen(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Открытие панели: всё до этого момента — прочитано (бейдж гаснет)."""
    current_user.notifications_seen_at = datetime.now(timezone.utc)
    await db.flush()
    return Response(status_code=204)
