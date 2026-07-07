import logging
import urllib.parse
from datetime import datetime, timezone
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models.page import Page
from app.models.snapshot import PageSnapshot
from app.models.baseline import Baseline
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.models.project import Project, ProjectCredential
from app.models.user import User
from app.project_access import (
    connection_for,
    get_or_create_demo_project,
    render_page_html,
    require_confluence_project,
    require_page_access,
    require_project_access,
    run_confluence,
    url_belongs_to_base,
)
from app.schemas.page import (
    PageCreate, PageListItem, PageDetail,
    SnapshotInfo, BaselineInfo,
    TreeNodeItem, SpaceTreeResponse, ProjectTreeResponse, TreeSyncResult,
)
from app.services import confluence
from app.services.confluence import ConfluenceAuthError, ConfluenceConnection
from app.services.diff_engine import has_text_changed
from app.services.highlight_projection import project_highlights

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


def _page_detail(
    page: Page,
    project: Project,
    snapshot: PageSnapshot | None,
    baseline: Baseline | None,
) -> PageDetail:
    return PageDetail(
        id=page.id,
        project_id=project.id,
        project_name=project.name,
        jira_base_url=project.jira_base_url or "",
        confluence_page_id=page.confluence_page_id,
        confluence_url=page.confluence_url,
        title=page.title,
        space_key=page.space_key,
        is_virtual=page.is_virtual,
        created_at=page.created_at,
        current_snapshot=SnapshotInfo(
            id=snapshot.id,
            confluence_version=snapshot.confluence_version,
            fetched_at=snapshot.fetched_at,
        ) if snapshot else None,
        baseline=BaselineInfo(
            id=baseline.id,
            snapshot_id=baseline.snapshot_id,
            confirmed_by=baseline.confirmed_by,
            confirmed_at=baseline.confirmed_at,
        ) if baseline else None,
        content_html=render_page_html(snapshot.content_html, page.id, project) if snapshot else None,
    )


async def _visible_project_ids(db: AsyncSession, user: User) -> list[UUID]:
    """Проекты, контент которых доступен пользователю: креды ok + свои демо."""
    ok_result = await db.execute(
        select(ProjectCredential.project_id).where(
            ProjectCredential.user_id == user.id,
            ProjectCredential.status == "ok",
        )
    )
    demo_result = await db.execute(
        select(Project.id).where(
            Project.is_demo == True, Project.created_by == user.id  # noqa: E712
        )
    )
    return list(ok_result.scalars().all()) + list(demo_result.scalars().all())


@router.post("/demo", response_model=PageDetail)
async def add_demo_page(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a demo page with sample content for testing without Confluence.

    Живёт в личном демо-проекте пользователя (создаётся при первом использовании).
    """
    import uuid as _uuid

    project = await get_or_create_demo_project(db, current_user)
    demo_id = "demo-" + str(_uuid.uuid4())[:8]

    page = Page(
        project_id=project.id,
        confluence_page_id=demo_id,
        confluence_url=f"https://confluence.example.com/pages/viewpage.action?pageId={demo_id}",
        title="Экран «Каталог товаров» — Требования",
        space_key="DEMO",
        added_by=current_user.id,
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
        confirmed_by=current_user.id,
    )
    db.add(baseline)
    await db.flush()

    return _page_detail(page, project, snapshot, baseline)


@router.post("", response_model=PageDetail)
async def add_page(
    data: PageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a Confluence page by URL. Fetches content and creates initial baseline.

    Проект определяется по base_url ссылки среди проектов пользователя; если
    ссылка подходит нескольким проектам (общий сервер) — обязателен project_id.
    """
    try:
        page_id_str = confluence.extract_page_id_from_url(data.confluence_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    memberships = await db.execute(
        select(Project, ProjectCredential)
        .join(ProjectCredential, ProjectCredential.project_id == Project.id)
        .where(
            ProjectCredential.user_id == current_user.id,
            Project.is_demo == False,  # noqa: E712
        )
    )
    candidates = [
        (project, cred) for project, cred in memberships.all()
        if url_belongs_to_base(data.confluence_url, project.confluence_base_url)
    ]

    if data.project_id is not None:
        matched = [(p, c) for p, c in candidates if p.id == data.project_id]
        if not matched:
            raise HTTPException(status_code=400, detail="Ссылка не относится к выбранному проекту")
        project, cred = matched[0]
    elif len(candidates) == 1:
        project, cred = candidates[0]
    elif not candidates:
        raise HTTPException(
            status_code=400,
            detail="Не найден проект с этим Confluence-сервером. Подключите проект в профиле",
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="Ссылка подходит нескольким проектам — укажите, в какой добавить страницу",
        )

    if cred.status != "ok":
        raise HTTPException(
            status_code=403,
            detail=f"Нет доступа к проекту «{project.name}». Проверьте креды в профиле",
        )

    existing_result = await db.execute(
        select(Page).where(
            Page.project_id == project.id,
            Page.confluence_page_id == page_id_str,
        )
    )
    existing_page = existing_result.scalar_one_or_none()
    if existing_page and not existing_page.is_virtual:
        raise HTTPException(status_code=409, detail="Page already tracked")

    conn = connection_for(project, cred)

    try:
        page_data = await run_confluence(
            db, project, cred, confluence.fetch_page(page_id_str, conn)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to fetch Confluence page %s: %s", page_id_str, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch page from Confluence: {e}")

    # Sync full space tree: create virtual pages for ALL pages in the space
    conf_base_url = project.confluence_base_url
    try:
        space_pages = await confluence.fetch_space_pages(page_data.space_key, conn)
    except Exception as e:
        # Сюда попадает и ConfluenceAuthError: страница доступна, а листинг
        # спейса — нет. Добавление не валим, откатываемся на ancestors.
        logger.warning("Failed to fetch space tree for %s: %s — falling back to ancestors only",
                       page_data.space_key, e)
        space_pages = []

    if space_pages:
        # Build a set of confluence_page_ids already in the DB for this space
        space_existing = await db.execute(
            select(Page.confluence_page_id).where(
                Page.project_id == project.id,
                Page.space_key == page_data.space_key,
            )
        )
        existing_cpids = set(space_existing.scalars().all())

        for sp in space_pages:
            if sp.page_id not in existing_cpids and sp.page_id != page_id_str:
                virtual_page = Page(
                    project_id=project.id,
                    confluence_page_id=sp.page_id,
                    confluence_url=f"{conf_base_url}/pages/viewpage.action?pageId={sp.page_id}",
                    title=sp.title,
                    space_key=page_data.space_key,
                    parent_confluence_page_id=sp.parent_page_id,
                    is_virtual=True,
                    added_by=current_user.id,
                )
                db.add(virtual_page)
                existing_cpids.add(sp.page_id)
        await db.flush()
    else:
        # Fallback: create virtual ancestors only (original behavior)
        prev_ancestor_id: str | None = None
        for ancestor in page_data.ancestors:
            existing_ancestor = await db.execute(
                select(Page).where(
                    Page.project_id == project.id,
                    Page.confluence_page_id == ancestor.page_id,
                )
            )
            if not existing_ancestor.scalar_one_or_none():
                virtual_page = Page(
                    project_id=project.id,
                    confluence_page_id=ancestor.page_id,
                    confluence_url=f"{conf_base_url}/pages/viewpage.action?pageId={ancestor.page_id}",
                    title=ancestor.title,
                    space_key=page_data.space_key,
                    parent_confluence_page_id=prev_ancestor_id,
                    is_virtual=True,
                    added_by=current_user.id,
                )
                db.add(virtual_page)
                await db.flush()
            prev_ancestor_id = ancestor.page_id

    # Determine parent: last ancestor in the chain
    parent_cpid = page_data.ancestors[-1].page_id if page_data.ancestors else None

    if existing_page and existing_page.is_virtual:
        # Convert virtual page to a real tracked page
        existing_page.is_virtual = False
        existing_page.confluence_url = data.confluence_url
        existing_page.title = page_data.title
        existing_page.space_key = page_data.space_key
        existing_page.parent_confluence_page_id = parent_cpid
        page = existing_page
        await db.flush()
    else:
        page = Page(
            project_id=project.id,
            confluence_page_id=page_data.page_id,
            confluence_url=data.confluence_url,
            title=page_data.title,
            space_key=page_data.space_key,
            parent_confluence_page_id=parent_cpid,
            added_by=current_user.id,
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
        confirmed_by=current_user.id,
    )
    db.add(baseline)
    await db.flush()

    return _page_detail(page, project, snapshot, baseline)


@router.get("", response_model=list[PageListItem])
async def list_pages(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List tracked pages of the user's projects with coverage stats."""
    project_ids = await _visible_project_ids(db, current_user)
    if not project_ids:
        return []

    result = await db.execute(
        select(Page)
        .where(Page.is_virtual == False, Page.project_id.in_(project_ids))  # noqa: E712
        .order_by(Page.created_at.desc())
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
            project_id=page.project_id,
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


@router.get("/tree", response_model=list[ProjectTreeResponse])
async def get_page_tree(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Дерево: проекты пользователя → спейсы → страницы.

    Чужие проекты не видны вовсе; проект с нерабочими кредами — узел
    no_access без спейсов (замок в UI). Демо-проект — в конце списка.
    """
    memberships = await db.execute(
        select(Project, ProjectCredential)
        .join(ProjectCredential, ProjectCredential.project_id == Project.id)
        .where(
            ProjectCredential.user_id == current_user.id,
            Project.is_demo == False,  # noqa: E712
        )
        .order_by(Project.name)
    )
    entries: list[tuple[Project, bool]] = [
        (project, cred.status != "ok") for project, cred in memberships.all()
    ]
    demo_result = await db.execute(
        select(Project).where(
            Project.is_demo == True, Project.created_by == current_user.id  # noqa: E712
        )
    )
    entries += [(project, False) for project in demo_result.scalars().all()]

    visible_ids = [project.id for project, no_access in entries if not no_access]

    pages_by_project: dict[UUID, list[Page]] = {}
    status_counts: dict = {}
    if visible_ids:
        pages_result = await db.execute(
            select(Page)
            .where(Page.project_id.in_(visible_ids))
            .order_by(Page.space_key, Page.title)
        )
        for page in pages_result.scalars().all():
            pages_by_project.setdefault(page.project_id, []).append(page)

        # Счётчики привязок по статусам — одним GROUP BY-запросом на все страницы
        counts_result = await db.execute(
            select(Highlight.page_id, Highlight.status, func.count(Highlight.id))
            .join(Page, Page.id == Highlight.page_id)
            .where(Page.project_id.in_(visible_ids))
            .group_by(Highlight.page_id, Highlight.status)
        )
        for hl_page_id, hl_status, cnt in counts_result.all():
            status_counts.setdefault(hl_page_id, {})[hl_status] = cnt

    response: list[ProjectTreeResponse] = []
    for project, no_access in entries:
        spaces: dict[str, list[TreeNodeItem]] = {}
        for page in pages_by_project.get(project.id, []):
            by_status = status_counts.get(page.id, {})
            node = TreeNodeItem(
                id=page.id,
                confluence_page_id=page.confluence_page_id,
                title=page.title,
                space_key=page.space_key,
                is_virtual=page.is_virtual,
                parent_confluence_page_id=page.parent_confluence_page_id,
                highlights_active=by_status.get("active", 0),
                highlights_outdated=by_status.get("outdated", 0),
                highlights_lost=by_status.get("lost", 0),
                has_updates=False,
            )
            spaces.setdefault(page.space_key or "OTHER", []).append(node)

        response.append(ProjectTreeResponse(
            project_id=project.id,
            project_name=project.name,
            is_demo=project.is_demo,
            no_access=no_access,
            spaces=[SpaceTreeResponse(space_key=sk, pages=pg) for sk, pg in spaces.items()],
        ))

    return response


@router.post("/sync-tree", response_model=TreeSyncResult)
async def sync_tree(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-sync the page hierarchy from Confluence for the user's projects.

    Обходит проекты пользователя с рабочими кредами, каждый — его кредами.
    Отказ Confluence (401/403) помечает подключение invalid, синк продолжается
    по остальным проектам.

    Reflects pages that were moved (re-nested) in Confluence by updating their
    ``parent_confluence_page_id``/``title``, creates virtual pages for pages
    newly added in Confluence, and removes virtual pages that no longer exist
    there. Tracked (real) pages are never deleted — if one disappears from
    Confluence it is kept and only counted in ``missing_tracked``.
    """
    memberships = await db.execute(
        select(Project, ProjectCredential)
        .join(ProjectCredential, ProjectCredential.project_id == Project.id)
        .where(
            ProjectCredential.user_id == current_user.id,
            ProjectCredential.status == "ok",
            Project.is_demo == False,  # noqa: E712
        )
        .order_by(Project.name)
    )

    synced_spaces = 0
    moved = added = removed = missing_tracked = 0

    for project, cred in memberships.all():
        conn = connection_for(project, cred)

        # Spaces that contain at least one tracked (real) page — virtual pages
        # only ever exist alongside a tracked page in the same space.
        spaces_result = await db.execute(
            select(Page.space_key)
            .where(
                Page.project_id == project.id,
                Page.is_virtual == False,  # noqa: E712
                Page.space_key.isnot(None),
            )
            .distinct()
        )
        space_keys = [s for s in spaces_result.scalars().all() if s]

        auth_failed = False
        for space_key in space_keys:
            try:
                space_pages = await confluence.fetch_space_pages(space_key, conn)
            except ConfluenceAuthError:
                # Креды протухли — помечаем и идём к следующему проекту;
                # замок появится при следующей загрузке дерева.
                cred.status = "invalid"
                cred.last_check_at = datetime.now(timezone.utc)
                await db.flush()
                auth_failed = True
                break
            except Exception as e:
                logger.warning("sync-tree: failed to fetch space %s: %s — skipping", space_key, e)
                continue

            synced_spaces += 1
            fresh = {sp.page_id: sp for sp in space_pages}

            db_pages_result = await db.execute(
                select(Page).where(
                    Page.project_id == project.id,
                    Page.space_key == space_key,
                )
            )
            db_pages = db_pages_result.scalars().all()
            db_cpids = {p.confluence_page_id for p in db_pages}

            # 1. Update existing pages (re-parent + title); handle disappeared ones.
            #    parent_confluence_page_id has no FK to other pages, so deleting a
            #    stale virtual parent here never breaks its (already re-parented) children.
            for page in db_pages:
                sp = fresh.get(page.confluence_page_id)
                if sp is not None:
                    if page.parent_confluence_page_id != sp.parent_page_id:
                        page.parent_confluence_page_id = sp.parent_page_id
                        moved += 1
                    if page.title != sp.title:
                        page.title = sp.title
                elif page.is_virtual:
                    # Virtual placeholder gone from Confluence — safe to drop.
                    await db.delete(page)
                    removed += 1
                else:
                    # Tracked page with real data — keep it, just flag it.
                    missing_tracked += 1

            # 2. Create virtual pages for Confluence pages not yet known locally.
            for cpid, sp in fresh.items():
                if cpid not in db_cpids:
                    db.add(Page(
                        project_id=project.id,
                        confluence_page_id=cpid,
                        confluence_url=f"{project.confluence_base_url}/pages/viewpage.action?pageId={cpid}",
                        title=sp.title,
                        space_key=space_key,
                        parent_confluence_page_id=sp.parent_page_id,
                        is_virtual=True,
                        added_by=current_user.id,
                    ))
                    added += 1

            await db.flush()

        if auth_failed:
            continue

    return TreeSyncResult(
        spaces=synced_spaces,
        moved=moved,
        added=added,
        removed=removed,
        missing_tracked=missing_tracked,
    )


@router.get("/{page_id}", response_model=PageDetail)
async def get_page(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get detailed page information with current content (участникам проекта)."""
    page, project, _ = await require_page_access(db, page_id, current_user)

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

    return _page_detail(page, project, latest_snapshot, latest_baseline)


@router.post("/{page_id}/promote", response_model=PageDetail)
async def promote_page(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Promote a virtual page to a fully tracked page by fetching its content from Confluence."""
    page, project, cred = await require_page_access(db, page_id, current_user)
    if not page.is_virtual:
        raise HTTPException(status_code=400, detail="Page is already tracked")
    require_confluence_project(project)

    conn = connection_for(project, cred)
    try:
        page_data = await run_confluence(
            db, project, cred, confluence.fetch_page(page.confluence_page_id, conn)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to fetch Confluence page %s: %s", page.confluence_page_id, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch page from Confluence: {e}")

    page.is_virtual = False
    page.title = page_data.title
    page.confluence_url = f"{project.confluence_base_url}/pages/viewpage.action?pageId={page.confluence_page_id}"
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
        confirmed_by=current_user.id,
    )
    db.add(baseline)
    await db.flush()

    return _page_detail(page, project, snapshot, baseline)


@router.post("/{page_id}/refresh", response_model=PageDetail)
async def refresh_page(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Refresh page content from Confluence. Projects highlights if content changed."""
    page, project, cred = await require_page_access(db, page_id, current_user)
    require_confluence_project(project)

    conn = connection_for(project, cred)
    try:
        page_data = await run_confluence(
            db, project, cred, confluence.fetch_page(page.confluence_page_id, conn)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from Confluence: {e}")

    # Keep this page's place in the tree current: moving a page in Confluence
    # changes its ancestors without touching content, so do this before the
    # "content unchanged" early-return below (get_db commits the change anyway).
    new_parent = page_data.ancestors[-1].page_id if page_data.ancestors else None
    if page.parent_confluence_page_id != new_parent:
        page.parent_confluence_page_id = new_parent

    snap_result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_result.scalar_one_or_none()

    if latest_snapshot and not has_text_changed(latest_snapshot.content_html, page_data.content_html):
        return await get_page(page_id, db, current_user)

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

        # Проекция — строго в координатах ОБРАБОТАННОГО HTML (render_page_html):
        # якоря привязок фронт считал по нему. Сырой storage-XML давал другую
        # разбивку на блоки (текст ссылок/кода в CDATA невидим парсеру), из-за
        # чего якоря дрейфовали при каждом обновлении.
        rendered_new = render_page_html(page_data.content_html, page.id, project) or ""
        rendered_old = (
            render_page_html(latest_snapshot.content_html, page.id, project)
            if latest_snapshot else None
        )
        projected = project_highlights(hl_dicts, rendered_new, rendered_old)

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
    return await get_page(page_id, db, current_user)


@router.post("/{page_id}/baseline", response_model=BaselineInfo)
async def set_baseline(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set the current snapshot as the new baseline."""
    page, _, _ = await require_page_access(db, page_id, current_user)

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
        confirmed_by=current_user.id,
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
async def delete_page(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a tracked page and all its related data (snapshots, baselines, highlights).
    Also cleans up orphaned virtual ancestors."""
    page, project, _ = await require_page_access(db, page_id, current_user)

    # Remember space key before deletion
    space_key = page.space_key

    highlight_ids_q = select(Highlight.id).where(Highlight.page_id == page_id)
    await db.execute(
        delete(HighlightTest).where(HighlightTest.highlight_id.in_(highlight_ids_q))
    )
    await db.execute(delete(Highlight).where(Highlight.page_id == page_id))
    await db.execute(delete(Baseline).where(Baseline.page_id == page_id))
    await db.execute(delete(PageSnapshot).where(PageSnapshot.page_id == page_id))

    await db.delete(page)
    await db.flush()

    # If no real (non-virtual) pages remain in this space, clean up all virtual pages
    if space_key:
        real_count_result = await db.execute(
            select(func.count(Page.id))
            .where(
                Page.project_id == project.id,
                Page.space_key == space_key,
                Page.is_virtual == False,  # noqa: E712
            )
        )
        real_count = real_count_result.scalar() or 0

        if real_count == 0:
            # Bulk-remove all remaining virtual pages in this space
            await db.execute(
                delete(Page).where(
                    Page.project_id == project.id,
                    Page.space_key == space_key,
                    Page.is_virtual == True,  # noqa: E712
                )
            )
            await db.flush()

    # Опустевший демо-проект удаляем вместе с последней страницей: пустой он
    # только висит в дереве, а при следующей демо-странице создастся заново
    # (get_or_create_demo_project). У демо нет кред — терять нечего.
    if project.is_demo:
        remaining_result = await db.execute(
            select(func.count(Page.id)).where(Page.project_id == project.id)
        )
        if (remaining_result.scalar() or 0) == 0:
            await db.delete(project)
            await db.flush()

    return Response(status_code=204)


async def _confluence_image_response(
    download_url: str, conn: ConfluenceConnection
) -> Response:
    """Fetch an image from Confluence and return it as a FastAPI Response."""
    auth = None
    if conn.username and conn.password:
        auth = httpx.BasicAuth(conn.username, conn.password)

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(download_url, auth=auth)

    if resp.status_code in (401, 403):
        # Протухшие креды должны пометить подключение (см. run_confluence),
        # а не маскироваться под «вложение не найдено».
        raise ConfluenceAuthError(resp.status_code)
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
    page_id: UUID,
    filename: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy a page attachment image from Confluence (кредами участника)."""
    page, project, cred = await require_page_access(db, page_id, current_user)
    require_confluence_project(project)

    conn = connection_for(project, cred)

    decoded = urllib.parse.unquote(filename)
    encoded = urllib.parse.quote(decoded, safe="")
    download_url = f"{project.confluence_base_url}/download/attachments/{page.confluence_page_id}/{encoded}"

    return await run_confluence(
        db, project, cred, _confluence_image_response(download_url, conn)
    )


confluence_proxy_router = APIRouter(prefix="/api", tags=["proxy"])


@confluence_proxy_router.get("/confluence-proxy")
async def proxy_confluence_resource(
    url: str = Query(..., description="Relative Confluence URL to proxy"),
    project_id: UUID = Query(..., description="Проект, чьим сервером и кредами идти"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy any relative Confluence resource (images, thumbnails, etc.).

    Относительный URL сам по себе проект не определяет, поэтому project_id
    обязателен — он вшивается в прокси-ссылки при рендере контента.
    """
    if not url.startswith("/"):
        raise HTTPException(status_code=400, detail="Only relative URLs are allowed")

    project = await db.get(Project, project_id)
    if not project or project.is_demo:
        raise HTTPException(status_code=404, detail="Project not found")
    cred = await require_project_access(db, project, current_user)

    conn = connection_for(project, cred)
    full_url = project.confluence_base_url + url

    return await run_confluence(
        db, project, cred, _confluence_image_response(full_url, conn)
    )
