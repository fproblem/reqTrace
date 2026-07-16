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

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models.project import Project, ProjectCredential
from app.models.refresh_run import RefreshRun
from app.models.user import User
from app.schemas.notification import NotificationEntry, NotificationsResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

WINDOW_DAYS = 14   # старше — не новости; журнал остаётся полным
MAX_ENTRIES = 50


def _entries_for_run(
    run: RefreshRun, project_name: str, user_id, digest_visible: bool
) -> list[NotificationEntry]:
    """Записи панели по одной строке журнала (чистая сборка — тестируется напрямую)."""
    entries: list[NotificationEntry] = []
    details = run.details or {}
    skipped_reason = details.get("skipped_reason")
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

    if run.status == "skipped":
        # no_credentials не показываем: без единого рабочего подключения
        # проект не виден никому, а причина уже отражена личными записями.
        if skipped_reason in ("confluence_unreachable", "no_valid_credentials"):
            entries.append(NotificationEntry(
                id=f"{run.id}:skip", kind="run_skipped",
                skipped_reason=skipped_reason, **base,
            ))
        return entries

    # Значимость дайджеста — переходы, потери, ошибки страниц (план §3.4);
    # изменившиеся страницы без задетых привязок — кандидат v1.6.4.
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
        skipped_reason=skipped_reason,
        **base,
    ))
    return entries


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

    entries: list[NotificationEntry] = []
    for run, project_name in runs_result.all():
        entries.extend(_entries_for_run(
            run, project_name, current_user.id,
            digest_visible=run.project_id in ok_ids,
        ))

    entries.sort(key=lambda e: e.happened_at, reverse=True)
    entries = entries[:MAX_ENTRIES]

    seen_at = current_user.notifications_seen_at
    for entry in entries:
        entry.unseen = seen_at is None or entry.happened_at > seen_at

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
