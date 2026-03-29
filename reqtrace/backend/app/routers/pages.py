import logging
import urllib.parse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.page import Page
from app.models.snapshot import PageSnapshot
from app.models.baseline import Baseline
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.schemas.page import (
    PageCreate, PageListItem, PageDetail,
    SnapshotInfo, BaselineInfo, BaselineCreate, RefreshRequest,
    TreeNodeItem, SpaceTreeResponse,
)
from app.services import confluence
from app.services.confluence import ConfluenceConnection, process_confluence_html
from app.services.diff_engine import has_text_changed
from app.services.highlight_projection import project_highlights
from app.routers.settings import get_confluence_params, get_jira_base_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pages", tags=["pages"])

DEMO_HTML = """
<h1>Экран «Каталог товаров»</h1>
<h2>1. Инициализация</h2>
<p>При открытии экрана каталога приложение отправляет запрос <code>GET /api/v2/catalog</code>
с параметрами <code>page=1</code>, <code>limit=20</code>, <code>sort=popular</code>.
Данные кешируются на 5 минут. При отсутствии сети отображается последний закешированный результат.</p>
<h2>2. Компоновка</h2>
<table>
<tr><th>Элемент</th><th>Описание</th></tr>
<tr><td>Поисковая строка</td><td>Отображается в верхней части экрана. Placeholder: «Найти товар». При фокусе появляется клавиатура. Иконка лупы слева, крестик очистки справа (появляется при вводе текста).</td></tr>
<tr><td>Фильтры</td><td>Горизонтальный скролл с пилюлями категорий. Активная категория выделена зелёным фоном. По умолчанию выбрана «Все».</td></tr>
<tr><td>Карточка товара</td><td>Сетка 2 колонки. Содержит: изображение (aspect ratio 1:1, скругление 12px), название (макс. 2 строки, обрезка с многоточием), цена (жирный шрифт), кнопка «В корзину».</td></tr>
<tr><td>Пустое состояние</td><td>Отображается при пустом результате поиска. Иконка, текст «Ничего не найдено», кнопка «Сбросить фильтры».</td></tr>
</table>
<h2>3. Логика работы</h2>
<p>При нажатии на карточку товара — переход на экран детальной информации. Анимация push-перехода, длительность 300мс.</p>
<p>При нажатии «В корзину» — товар добавляется в корзину. Кнопка меняется на счётчик с «−» и «+». Запрос <code>POST /api/v2/cart/add</code> отправляется с задержкой 500мс (debounce) для группировки быстрых нажатий.</p>
<p>Pull-to-refresh обновляет каталог. Во время обновления отображается индикатор загрузки. Если запрос завершился ошибкой — показывается toast «Не удалось обновить каталог» с кнопкой «Повторить».</p>
<h2>4. Пагинация</h2>
<p>Бесконечная прокрутка. При достижении конца списка автоматически загружается следующая страница. Индикатор загрузки внизу списка. Если достигнут конец каталога — текст «Вы просмотрели все товары».</p>
"""


async def _render_html(raw_html: str | None, page_id, db: AsyncSession) -> str | None:
    """Process stored Confluence HTML so images, Jira links, statuses etc. render correctly."""
    if not raw_html:
        return raw_html
    jira_url = await get_jira_base_url(db)
    return process_confluence_html(raw_html, str(page_id), jira_base_url=jira_url)


@router.post("/demo", response_model=PageDetail)
async def add_demo_page(data: BaselineCreate, db: AsyncSession = Depends(get_db)):
    """Add a demo page with sample content for testing without Confluence."""
    import uuid as _uuid

    demo_id = "demo-" + str(_uuid.uuid4())[:8]

    page = Page(
        confluence_page_id=demo_id,
        confluence_url=f"https://confluence.example.com/pages/viewpage.action?pageId={demo_id}",
        title="Экран «Каталог товаров» — Требования",
        space_key="DEMO",
        added_by=data.user_id,
    )
    db.add(page)
    await db.flush()

    snapshot = PageSnapshot(
        page_id=page.id,
        confluence_version=1,
        content_html=DEMO_HTML,
    )
    db.add(snapshot)
    await db.flush()

    baseline = Baseline(
        page_id=page.id,
        snapshot_id=snapshot.id,
        confirmed_by=data.user_id,
    )
    db.add(baseline)
    await db.flush()

    return PageDetail(
        id=page.id,
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=snapshot.id,
            confluence_version=snapshot.confluence_version,
            fetched_at=snapshot.fetched_at,
        ),
        baseline=BaselineInfo(
            id=baseline.id,
            snapshot_id=baseline.snapshot_id,
            confirmed_by=baseline.confirmed_by,
            confirmed_at=baseline.confirmed_at,
        ),
        content_html=await _render_html(snapshot.content_html, page.id, db),
    )


@router.post("", response_model=PageDetail)
async def add_page(data: PageCreate, db: AsyncSession = Depends(get_db)):
    """Add a Confluence page by URL. Fetches content and creates initial baseline."""
    try:
        page_id_str = confluence.extract_page_id_from_url(data.confluence_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    existing = await db.execute(
        select(Page).where(Page.confluence_page_id == page_id_str)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Page already tracked")

    params = await get_confluence_params(db)
    conn = ConfluenceConnection(**params)

    try:
        page_data = await confluence.fetch_page(page_id_str, conn)
    except Exception as e:
        logger.error("Failed to fetch Confluence page %s: %s", page_id_str, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch page from Confluence: {e}")

    # Create virtual ancestor pages from Confluence hierarchy
    conf_base_url = params["base_url"].rstrip("/")
    prev_ancestor_id: str | None = None
    for ancestor in page_data.ancestors:
        existing_ancestor = await db.execute(
            select(Page).where(Page.confluence_page_id == ancestor.page_id)
        )
        if not existing_ancestor.scalar_one_or_none():
            virtual_page = Page(
                confluence_page_id=ancestor.page_id,
                confluence_url=f"{conf_base_url}/pages/viewpage.action?pageId={ancestor.page_id}",
                title=ancestor.title,
                space_key=page_data.space_key,
                parent_confluence_page_id=prev_ancestor_id,
                is_virtual=True,
                added_by=data.user_id,
            )
            db.add(virtual_page)
            await db.flush()
        prev_ancestor_id = ancestor.page_id

    # Determine parent: last ancestor in the chain
    parent_cpid = page_data.ancestors[-1].page_id if page_data.ancestors else None

    page = Page(
        confluence_page_id=page_data.page_id,
        confluence_url=data.confluence_url,
        title=page_data.title,
        space_key=page_data.space_key,
        parent_confluence_page_id=parent_cpid,
        added_by=data.user_id,
    )
    db.add(page)
    await db.flush()

    snapshot = PageSnapshot(
        page_id=page.id,
        confluence_version=page_data.version,
        content_html=page_data.content_html,
    )
    db.add(snapshot)
    await db.flush()

    baseline = Baseline(
        page_id=page.id,
        snapshot_id=snapshot.id,
        confirmed_by=data.user_id,
    )
    db.add(baseline)
    await db.flush()

    return PageDetail(
        id=page.id,
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=snapshot.id,
            confluence_version=snapshot.confluence_version,
            fetched_at=snapshot.fetched_at,
        ),
        baseline=BaselineInfo(
            id=baseline.id,
            snapshot_id=baseline.snapshot_id,
            confirmed_by=baseline.confirmed_by,
            confirmed_at=baseline.confirmed_at,
        ),
        content_html=await _render_html(snapshot.content_html, page.id, db),
    )


@router.get("", response_model=list[PageListItem])
async def list_pages(db: AsyncSession = Depends(get_db)):
    """List all tracked pages with coverage stats."""
    result = await db.execute(
        select(Page).where(Page.is_virtual == False).order_by(Page.created_at.desc())
    )
    pages = result.scalars().all()

    items = []
    for page in pages:
        snap_result = await db.execute(
            select(PageSnapshot)
            .where(PageSnapshot.page_id == page.id)
            .order_by(PageSnapshot.fetched_at.desc())
            .limit(1)
        )
        latest_snapshot = snap_result.scalar_one_or_none()

        bl_result = await db.execute(
            select(Baseline)
            .where(Baseline.page_id == page.id)
            .order_by(Baseline.confirmed_at.desc())
            .limit(1)
        )
        latest_baseline = bl_result.scalar_one_or_none()

        hl_count = await db.execute(
            select(func.count(Highlight.id))
            .where(Highlight.page_id == page.id)
        )
        highlight_count = hl_count.scalar() or 0

        has_updates = False

        items.append(PageListItem(
            id=page.id,
            confluence_page_id=page.confluence_page_id,
            confluence_url=page.confluence_url,
            title=page.title,
            space_key=page.space_key,
            created_at=page.created_at,
            last_snapshot_at=latest_snapshot.fetched_at if latest_snapshot else None,
            baseline_at=latest_baseline.confirmed_at if latest_baseline else None,
            coverage_percent=min(highlight_count * 10.0, 100.0),
            has_updates=has_updates,
        ))

    return items


@router.get("/tree", response_model=list[SpaceTreeResponse])
async def get_page_tree(db: AsyncSession = Depends(get_db)):
    """Get all pages grouped by space as a tree structure."""
    result = await db.execute(
        select(Page).order_by(Page.space_key, Page.title)
    )
    pages = result.scalars().all()

    # Compute coverage for tracked pages
    nodes: list[TreeNodeItem] = []
    for page in pages:
        coverage = 0.0
        if not page.is_virtual:
            hl_count = await db.execute(
                select(func.count(Highlight.id))
                .where(Highlight.page_id == page.id)
            )
            highlight_count = hl_count.scalar() or 0
            coverage = min(highlight_count * 10.0, 100.0)

        nodes.append(TreeNodeItem(
            id=page.id,
            confluence_page_id=page.confluence_page_id,
            title=page.title,
            space_key=page.space_key,
            is_virtual=page.is_virtual,
            parent_confluence_page_id=page.parent_confluence_page_id,
            coverage_percent=coverage,
            has_updates=False,
        ))

    # Group by space_key
    spaces: dict[str, list[TreeNodeItem]] = {}
    for node in nodes:
        key = node.space_key or "OTHER"
        spaces.setdefault(key, []).append(node)

    return [
        SpaceTreeResponse(space_key=sk, pages=pg)
        for sk, pg in spaces.items()
    ]


@router.get("/{page_id}", response_model=PageDetail)
async def get_page(page_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get detailed page information with current content."""
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

    bl_result = await db.execute(
        select(Baseline)
        .where(Baseline.page_id == page.id)
        .order_by(Baseline.confirmed_at.desc())
        .limit(1)
    )
    latest_baseline = bl_result.scalar_one_or_none()

    return PageDetail(
        id=page.id,
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=latest_snapshot.id,
            confluence_version=latest_snapshot.confluence_version,
            fetched_at=latest_snapshot.fetched_at,
        ) if latest_snapshot else None,
        baseline=BaselineInfo(
            id=latest_baseline.id,
            snapshot_id=latest_baseline.snapshot_id,
            confirmed_by=latest_baseline.confirmed_by,
            confirmed_at=latest_baseline.confirmed_at,
        ) if latest_baseline else None,
        content_html=(await _render_html(latest_snapshot.content_html, page.id, db)) if latest_snapshot else None,
    )


@router.post("/{page_id}/refresh", response_model=PageDetail)
async def refresh_page(page_id: UUID, data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Refresh page content from Confluence. Projects highlights if content changed."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    params = await get_confluence_params(db)
    conn = ConfluenceConnection(**params)

    try:
        page_data = await confluence.fetch_page(page.confluence_page_id, conn)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from Confluence: {e}")

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()

    if latest_snapshot and not has_text_changed(latest_snapshot.content_html, page_data.content_html):
        return await get_page(page_id, db)

    new_snapshot = PageSnapshot(
        page_id=page.id,
        confluence_version=page_data.version,
        content_html=page_data.content_html,
    )
    db.add(new_snapshot)
    await db.flush()

    page.title = page_data.title

    hl_result = await db.execute(
        select(Highlight)
        .where(Highlight.page_id == page.id, Highlight.status != "lost")
    )
    highlights = hl_result.scalars().all()

    if highlights:
        hl_dicts = [
            {
                "id": h.id,
                "text_content": h.text_content,
                "text_before": h.text_before or "",
                "text_after": h.text_after or "",
                "anchor_block_start": h.anchor_block_start,
                "anchor_block_end": h.anchor_block_end,
                "start_char_offset": h.start_char_offset,
                "end_char_offset": h.end_char_offset,
            }
            for h in highlights
        ]

        old_html = latest_snapshot.content_html if latest_snapshot else None
        projected = project_highlights(hl_dicts, page_data.content_html, old_html)

        for proj in projected:
            for h in highlights:
                if h.id == proj["id"]:
                    projected_status = proj["projected_status"]
                    # Only a human action (reanchor) can resolve outdated → active.
                    # Refresh must not silently clear an outdated status.
                    if h.status == "outdated" and projected_status == "active":
                        projected_status = "outdated"
                    h.status = projected_status
                    if "new_anchor_block_start" in proj:
                        h.anchor_block_start = proj["new_anchor_block_start"]
                        h.anchor_block_end = proj["new_anchor_block_end"]
                        h.start_char_offset = proj["new_start_char_offset"]
                        h.end_char_offset = proj["new_end_char_offset"]
                    break

    await db.flush()
    return await get_page(page_id, db)


@router.post("/{page_id}/baseline", response_model=BaselineInfo)
async def set_baseline(page_id: UUID, data: BaselineCreate, db: AsyncSession = Depends(get_db)):
    """Set the current snapshot as the new baseline."""
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
        raise HTTPException(status_code=400, detail="No snapshots available")

    baseline = Baseline(
        page_id=page.id,
        snapshot_id=latest_snapshot.id,
        confirmed_by=data.user_id,
    )
    db.add(baseline)

    await db.flush()
    await db.refresh(baseline)

    return BaselineInfo(
        id=baseline.id,
        snapshot_id=baseline.snapshot_id,
        confirmed_by=baseline.confirmed_by,
        confirmed_at=baseline.confirmed_at,
    )


@router.delete("/{page_id}", status_code=204)
async def delete_page(page_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a tracked page and all its related data (snapshots, baselines, highlights).
    Also cleans up orphaned virtual ancestors."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    # Remember parent chain before deletion
    parent_cpid = page.parent_confluence_page_id

    highlight_ids_q = select(Highlight.id).where(Highlight.page_id == page_id)
    await db.execute(
        delete(HighlightTest).where(HighlightTest.highlight_id.in_(highlight_ids_q))
    )
    await db.execute(delete(Highlight).where(Highlight.page_id == page_id))
    await db.execute(delete(Baseline).where(Baseline.page_id == page_id))
    await db.execute(delete(PageSnapshot).where(PageSnapshot.page_id == page_id))

    await db.delete(page)
    await db.flush()

    # Clean up orphaned virtual ancestors
    while parent_cpid:
        parent_result = await db.execute(
            select(Page).where(Page.confluence_page_id == parent_cpid)
        )
        parent_page = parent_result.scalar_one_or_none()
        if not parent_page or not parent_page.is_virtual:
            break

        # Check if this virtual page still has children
        children_count = await db.execute(
            select(func.count(Page.id))
            .where(Page.parent_confluence_page_id == parent_cpid)
        )
        if (children_count.scalar() or 0) > 0:
            break

        # No children left — remove this virtual page
        next_parent = parent_page.parent_confluence_page_id
        await db.delete(parent_page)
        await db.flush()
        parent_cpid = next_parent

    return Response(status_code=204)


async def _confluence_image_response(
    download_url: str, params: dict
) -> Response:
    """Fetch an image from Confluence and return it as a FastAPI Response."""
    auth = None
    if params["username"] and params["password"]:
        auth = httpx.BasicAuth(params["username"], params["password"])

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(download_url, auth=auth)

    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Attachment not found on Confluence")

    content_type = resp.headers.get("content-type", "application/octet-stream")
    return Response(
        content=resp.content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/{page_id}/attachments/{filename:path}")
async def get_attachment(
    page_id: UUID, filename: str, db: AsyncSession = Depends(get_db)
):
    """Proxy a page attachment image from Confluence."""
    page = await db.get(Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    params = await get_confluence_params(db)
    base_url = params["base_url"].rstrip("/")

    decoded = urllib.parse.unquote(filename)
    encoded = urllib.parse.quote(decoded, safe="")
    download_url = f"{base_url}/download/attachments/{page.confluence_page_id}/{encoded}"

    return await _confluence_image_response(download_url, params)


confluence_proxy_router = APIRouter(prefix="/api", tags=["proxy"])


@confluence_proxy_router.get("/confluence-proxy")
async def proxy_confluence_resource(
    url: str = Query(..., description="Relative Confluence URL to proxy"),
    db: AsyncSession = Depends(get_db),
):
    """Proxy any relative Confluence resource (images, thumbnails, etc.)."""
    if not url.startswith("/"):
        raise HTTPException(status_code=400, detail="Only relative URLs are allowed")

    params = await get_confluence_params(db)
    base_url = params["base_url"].rstrip("/")
    full_url = base_url + url

    return await _confluence_image_response(full_url, params)
