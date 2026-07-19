from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models.snapshot import PageSnapshot
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.models.user import User
from app.project_access import render_page_html, require_page_access
from app.schemas.highlight import (
    HighlightCreate, HighlightResponse,
    TestLinkCreate, TestLinkResponse,
)
from app.services import anchoring, test_names, page_service

HIGHLIGHT_LOAD_OPTIONS = [
    selectinload(Highlight.tests),
    selectinload(Highlight.created_by_user),
    selectinload(Highlight.reanchored_by_user),
]

router = APIRouter(tags=["highlights"])


@router.post("/api/pages/{page_id}/highlights", response_model=HighlightResponse)
async def create_highlight(
    page_id: UUID,
    data: HighlightCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    page, project, _ = await require_page_access(db, page_id, current_user)

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()
    if not latest_snapshot:
        raise HTTPException(status_code=400, detail="No snapshot available")

    # Модель «маркер в снимке» (v1.5.9): без блочного якоря привязке негде жить.
    if data.anchor_block_start is None:
        raise HTTPException(
            status_code=400,
            detail="Не удалось закрепить выделение за текстом — выделите текст внутри абзаца",
        )

    # Сопоставление по цитате происходит ровно один раз — здесь (контракт
    # эталона: textSelection+matchIndex при создании). Координаты, посчитанные
    # фронтом по DOM, обязаны указывать на текст цитаты в актуальном снимке.
    rendered = render_page_html(latest_snapshot.content_html, page.id, project) or ""
    verified = anchoring.verify_creation(
        rendered,
        data.anchor_block_start, data.anchor_block_end,
        data.start_char_offset or 0, data.end_char_offset or 0,
        data.text_content,
    )
    if verified is None:
        raise HTTPException(
            status_code=409,
            detail="Выделение не совпало с текущей версией страницы — обновите её и повторите",
        )

    highlight = Highlight(
        page_id=page.id,
        snapshot_id=latest_snapshot.id,
        start_xpath=data.start_xpath,
        start_offset=data.start_offset,
        end_xpath=data.end_xpath,
        end_offset=data.end_offset,
        text_content=data.text_content,
        anchored_text=verified["anchored_text"],
        text_before=data.text_before or "",
        text_after=data.text_after or "",
        anchor_block_start=verified["anchor_block_start"],
        anchor_block_end=verified["anchor_block_end"],
        start_char_offset=verified["start_char_offset"],
        end_char_offset=verified["end_char_offset"],
        # Только что созданное выделение ещё пустое (без тестов) и не подтверждено,
        # поэтому заводим его как "требует проверки", а не "актуально". Перевести
        # в "актуально" можно вручную через "Актуализировать" (reanchor). Refresh
        # не повышает статус автоматически.
        status="outdated",
        created_by=current_user.id,
    )
    db.add(highlight)
    await db.flush()
    await db.refresh(highlight, ["tests", "created_by_user"])

    return highlight


@router.get("/api/pages/{page_id}/highlights", response_model=list[HighlightResponse])
async def list_highlights(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, project, _ = await require_page_access(db, page_id, current_user)
    result = await db.execute(
        select(Highlight)
        .where(Highlight.page_id == page_id)
        .options(*HIGHLIGHT_LOAD_OPTIONS)
        .order_by(Highlight.created_at)
    )
    highlights = result.scalars().all()
    # Названия тестов из Jira (v1.7.0): дописываем атрибутом на ORM-объекты
    # связей — pydantic (from_attributes) подхватит; нет имени — None, UI
    # покажет только ключ, как раньше.
    details = await test_names.load_details(db, project.id)
    for h in highlights:
        for link in h.tests:
            row = details.get((link.test_key or "").upper())
            link.summary = row.summary if row else None
            link.jira_status = row.fetch_result if row else None
    return highlights


@router.delete("/api/highlights/{highlight_id}", status_code=204)
async def delete_highlight(
    highlight_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    highlight = await db.get(Highlight, highlight_id)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    await require_page_access(db, highlight.page_id, current_user)

    await db.delete(highlight)
    await db.flush()


@router.post("/api/highlights/{highlight_id}/reanchor", response_model=HighlightResponse)
async def reanchor_highlight(
    highlight_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """«Актуализировать»: подтвердить изменившийся текст под маркером.

    Модель «маркер в снимке» (v1.5.9): якорь всегда точен по инварианту —
    его поддерживает refresh (page_service). Поэтому актуализация больше НЕ
    ищет текст: замороженной цитатой (text_content) становится текущий текст
    под маркером (anchored_text), статус — «Актуально». Понижения/повышения
    статусов «сами по себе» невозможны: только refresh и это действие.
    """
    highlight = await db.get(Highlight, highlight_id, options=HIGHLIGHT_LOAD_OPTIONS)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    page, project, _ = await require_page_access(db, highlight.page_id, current_user)
    if highlight.status != "outdated":
        raise HTTPException(status_code=400, detail="Only outdated highlights can be reanchored")

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == highlight.page_id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()
    if not latest_snapshot:
        raise HTTPException(status_code=400, detail="No snapshot available")

    # Привязки из «до-v1.5.9» мира ещё не имеют anchored_text — извлекаем по
    # якорям из актуального снимка (якоря актуальны: v1.5.8 поддерживала их
    # на каждом refresh). Рассинхрон (пустой/битый якорь) — честный 409.
    anchored = highlight.anchored_text
    if anchored is None:
        rendered = render_page_html(
            latest_snapshot.content_html, highlight.page_id, project
        ) or ""
        anchored = page_service.extract_anchored_text(rendered, highlight)

    confirmed = anchoring.confirm_reanchor(anchored)
    if confirmed is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Под привязкой не найден текст в текущей версии страницы — "
                "актуализация отменена. Обновите страницу и проверьте выделение."
            ),
        )

    highlight.text_content = confirmed["text_content"]
    highlight.anchored_text = anchored
    highlight.status = "active"
    highlight.snapshot_id = latest_snapshot.id
    highlight.reanchored_by = current_user.id
    highlight.reanchored_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(highlight, ["tests", "created_by_user", "reanchored_by_user"])

    return highlight


# Эндпоинтов ручной смены статусов (mark-lost / unmark-lost / mark-outdated)
# больше нет (v1.5.9): статусы привязок меняет только refresh (page_service +
# anchoring) и «Актуализировать». Фронтенд статусы не пишет.


@router.post("/api/highlights/{highlight_id}/tests", response_model=TestLinkResponse)
async def add_test_link(
    highlight_id: UUID,
    data: TestLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    highlight = await db.get(Highlight, highlight_id)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    _, project, cred = await require_page_access(db, highlight.page_id, current_user)

    link = HighlightTest(
        highlight_id=highlight_id,
        test_key=data.test_key.strip().upper(),
        created_by=current_user.id,
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)

    # Название из Jira — сразу при привязке (v1.7.0): видно, «какой тест
    # креплю», а 404 честно валидирует опечатку до того, как мёртвый ключ
    # доживёт до ночного прогона. Строго best effort: без токена/сети
    # привязка создаётся ровно как раньше.
    summary, found = await test_names.fetch_name_on_link(
        db, project, cred, link.test_key,
    )
    link.summary = summary
    link.jira_found = found
    link.jira_status = None if found is None else ("ok" if found else "not_found")
    return link


@router.delete("/api/highlight-tests/{link_id}", status_code=204)
async def remove_test_link(
    link_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    link = await db.get(HighlightTest, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Test link not found")
    highlight = await db.get(Highlight, link.highlight_id)
    if highlight:
        await require_page_access(db, highlight.page_id, current_user)

    await db.delete(link)
    await db.flush()
