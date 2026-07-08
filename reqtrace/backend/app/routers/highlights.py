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
from app.services.highlight_projection import resolve_reanchor

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
    page, _, _ = await require_page_access(db, page_id, current_user)

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()
    if not latest_snapshot:
        raise HTTPException(status_code=400, detail="No snapshot available")

    highlight = Highlight(
        page_id=page.id,
        snapshot_id=latest_snapshot.id,
        start_xpath=data.start_xpath,
        start_offset=data.start_offset,
        end_xpath=data.end_xpath,
        end_offset=data.end_offset,
        text_content=data.text_content,
        text_before=data.text_before or "",
        text_after=data.text_after or "",
        anchor_block_start=data.anchor_block_start,
        anchor_block_end=data.anchor_block_end,
        start_char_offset=data.start_char_offset,
        end_char_offset=data.end_char_offset,
        # Только что созданное выделение ещё пустое (без тестов) и не подтверждено,
        # поэтому заводим его как "требует проверки", а не "актуально". Перевести
        # в "актуально" можно вручную через "Актуализировать" (reanchor). Refresh
        # не сбрасывает этот статус автоматически (см. refresh_page).
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
    await require_page_access(db, page_id, current_user)
    result = await db.execute(
        select(Highlight)
        .where(Highlight.page_id == page_id)
        .options(*HIGHLIGHT_LOAD_OPTIONS)
        .order_by(Highlight.created_at)
    )
    return result.scalars().all()


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
    """Re-anchor an outdated highlight to current content, making it active."""
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

    # Пересчёт — по ОБРАБОТАННОМУ HTML (координаты фронта) и без слепой
    # перезаписи: цитата либо подтверждается под якорем, либо находится текстовым
    # поиском (лечит съехавшие якоря), либо актуализация честно отклоняется —
    # раньше здесь молча записывался чужой текст со страницы (баг v1.5.6).
    if highlight.anchor_block_start is not None or highlight.text_content:
        rendered = render_page_html(
            latest_snapshot.content_html, highlight.page_id, project
        ) or ""
        resolved = resolve_reanchor(
            rendered,
            highlight.text_content or "",
            highlight.text_before or "",
            highlight.text_after or "",
            highlight.anchor_block_start,
            highlight.anchor_block_end,
            highlight.start_char_offset or 0,
            highlight.end_char_offset or 0,
        )
        if resolved is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Выделенный текст не найден в текущей версии страницы — "
                    "актуализация отменена, чтобы не потерять цитату. "
                    "Обновите страницу и проверьте выделение."
                ),
            )
        highlight.text_content = resolved["text_content"]
        highlight.text_before = resolved["text_before"]
        highlight.text_after = resolved["text_after"]
        highlight.anchor_block_start = resolved["anchor_block_start"]
        highlight.anchor_block_end = resolved["anchor_block_end"]
        highlight.start_char_offset = resolved["start_char_offset"]
        highlight.end_char_offset = resolved["end_char_offset"]

    highlight.status = "active"
    highlight.snapshot_id = latest_snapshot.id
    highlight.reanchored_by = current_user.id
    highlight.reanchored_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(highlight, ["tests", "created_by_user", "reanchored_by_user"])

    return highlight


@router.post("/api/highlights/{highlight_id}/mark-lost", response_model=HighlightResponse)
async def mark_highlight_lost(
    highlight_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Перевести привязку в статус "утрачено".

    Вызывается фронтендом, когда выделенный текст не удалось разместить на
    странице (ни по блочному якорю, ни текстовым поиском). Так привязка уходит
    в секцию «Утраченные» и в чип «утрачено» в верхней панели, где её легко найти.
    """
    highlight = await db.get(Highlight, highlight_id, options=HIGHLIGHT_LOAD_OPTIONS)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    await require_page_access(db, highlight.page_id, current_user)

    if highlight.status != "lost":
        highlight.status = "lost"
        await db.flush()
        await db.refresh(highlight, ["tests", "created_by_user", "reanchored_by_user"])

    return highlight


@router.post("/api/highlights/{highlight_id}/unmark-lost", response_model=HighlightResponse)
async def unmark_highlight_lost(
    highlight_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Вернуть привязку из «Утрачено», если она снова отображается на странице.

    Вызывается фронтендом, когда ранее утраченную привязку снова удалось
    разместить (например, текст вернулся или подсветка легла «разрывом» после
    правки). Переводим её в «Требует проверки», чтобы пользователь подтвердил.
    """
    highlight = await db.get(Highlight, highlight_id, options=HIGHLIGHT_LOAD_OPTIONS)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    await require_page_access(db, highlight.page_id, current_user)

    if highlight.status == "lost":
        highlight.status = "outdated"
        await db.flush()
        await db.refresh(highlight, ["tests", "created_by_user", "reanchored_by_user"])

    return highlight


@router.post("/api/highlights/{highlight_id}/mark-outdated", response_model=HighlightResponse)
async def mark_highlight_outdated(
    highlight_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Понизить «актуальную» привязку до «Требует проверки».

    Вызывается фронтендом, когда цитату отредактировали и слой разместил её
    лишь ЧАСТИЧНО — уцелевшими кусками в якорном блоке (v1.5.8). Понижаем
    только из «актуально»: возврат из «Утрачено» идёт через unmark-lost, а
    уже «требующие проверки» остаются как есть.
    """
    highlight = await db.get(Highlight, highlight_id, options=HIGHLIGHT_LOAD_OPTIONS)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    await require_page_access(db, highlight.page_id, current_user)

    if highlight.status == "active":
        highlight.status = "outdated"
        await db.flush()
        await db.refresh(highlight, ["tests", "created_by_user", "reanchored_by_user"])

    return highlight


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
    await require_page_access(db, highlight.page_id, current_user)

    link = HighlightTest(
        highlight_id=highlight_id,
        test_key=data.test_key.strip().upper(),
        created_by=current_user.id,
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)

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
