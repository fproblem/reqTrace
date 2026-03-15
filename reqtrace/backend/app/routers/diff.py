from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.page import Page
from app.models.snapshot import PageSnapshot
from app.models.baseline import Baseline
from app.schemas.diff import DiffResponse
from app.services.diff_engine import compute_diff_html

router = APIRouter(prefix="/api/pages", tags=["diff"])


@router.get("/{page_id}/diff", response_model=DiffResponse)
async def get_diff(page_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get diff between baseline and latest snapshot."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    bl_result = await db.execute(
        select(Baseline)
        .where(Baseline.page_id == page.id)
        .order_by(Baseline.confirmed_at.desc())
        .limit(1)
    )
    baseline = bl_result.scalar_one_or_none()
    if not baseline:
        raise HTTPException(status_code=400, detail="No baseline set")

    baseline_snapshot = await db.get(PageSnapshot, baseline.snapshot_id)

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()
    if not latest_snapshot:
        raise HTTPException(status_code=400, detail="No snapshots available")

    if baseline_snapshot.id == latest_snapshot.id:
        return DiffResponse(
            has_changes=False,
            diff_html="",
            baseline_version=baseline_snapshot.confluence_version,
            current_version=latest_snapshot.confluence_version,
        )

    diff_html = compute_diff_html(baseline_snapshot.content_html, latest_snapshot.content_html)

    return DiffResponse(
        has_changes=True,
        diff_html=diff_html,
        baseline_version=baseline_snapshot.confluence_version,
        current_version=latest_snapshot.confluence_version,
    )
