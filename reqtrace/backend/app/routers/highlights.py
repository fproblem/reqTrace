from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.page import Page
from app.models.snapshot import PageSnapshot
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.schemas.highlight import (
    HighlightCreate, HighlightResponse,
    TestLinkCreate, TestLinkResponse,
    ReanchorRequest,
)
from app.services.highlight_projection import extract_text_at_anchor

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
):
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

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
        status="active",
        created_by=data.user_id,
    )
    db.add(highlight)
    await db.flush()
    await db.refresh(highlight, ["tests", "created_by_user"])

    return highlight


@router.get("/api/pages/{page_id}/highlights", response_model=list[HighlightResponse])
async def list_highlights(page_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Highlight)
        .where(Highlight.page_id == page_id)
        .options(*HIGHLIGHT_LOAD_OPTIONS)
        .order_by(Highlight.created_at)
    )
    return result.scalars().all()


@router.delete("/api/highlights/{highlight_id}", status_code=204)
async def delete_highlight(highlight_id: UUID, db: AsyncSession = Depends(get_db)):
    highlight = await db.get(Highlight, highlight_id)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")

    await db.delete(highlight)
    await db.flush()


@router.post("/api/highlights/{highlight_id}/reanchor", response_model=HighlightResponse)
async def reanchor_highlight(
    highlight_id: UUID,
    data: ReanchorRequest,
    db: AsyncSession = Depends(get_db),
):
    """Re-anchor an outdated highlight to current content, making it active."""
    highlight = await db.get(Highlight, highlight_id, options=HIGHLIGHT_LOAD_OPTIONS)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
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

    if highlight.anchor_block_start is not None:
        extracted = extract_text_at_anchor(
            latest_snapshot.content_html,
            highlight.anchor_block_start,
            highlight.anchor_block_end,
            highlight.start_char_offset or 0,
            highlight.end_char_offset or 0,
        )
        highlight.text_content = extracted["text_content"]
        highlight.text_before = extracted["text_before"]
        highlight.text_after = extracted["text_after"]

    highlight.status = "active"
    highlight.snapshot_id = latest_snapshot.id
    highlight.reanchored_by = data.user_id
    highlight.reanchored_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(highlight, ["tests", "created_by_user", "reanchored_by_user"])

    return highlight


@router.post("/api/highlights/{highlight_id}/tests", response_model=TestLinkResponse)
async def add_test_link(
    highlight_id: UUID,
    data: TestLinkCreate,
    db: AsyncSession = Depends(get_db),
):
    highlight = await db.get(Highlight, highlight_id)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")

    link = HighlightTest(
        highlight_id=highlight_id,
        test_key=data.test_key.strip().upper(),
        created_by=data.user_id,
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)

    return link


@router.delete("/api/highlight-tests/{link_id}", status_code=204)
async def remove_test_link(link_id: UUID, db: AsyncSession = Depends(get_db)):
    link = await db.get(HighlightTest, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Test link not found")

    await db.delete(link)
    await db.flush()
