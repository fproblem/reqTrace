"""Сверка дерева проекта со спейсами Confluence.

Ядро POST /pages/sync-tree (v1.4.0), вынесено из роутера для ночного
автообновления (v1.6.2): эндпоинт сверяет проекты пользователя его кредами,
джоба — все проекты рабочими кредами участников. Сама сверка общая:
re-parent/переименование существующих страниц, виртуальные страницы для
новых в Confluence, удаление исчезнувших виртуальных; отслеживаемые (real)
страницы не удаляются никогда — только счётчик missing_tracked.
"""
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.page import Page
from app.models.project import Project
from app.services import confluence
from app.services.confluence import ConfluenceAuthError, ConfluenceConnection

logger = logging.getLogger(__name__)


@dataclass
class TreeSyncStats:
    spaces: int = 0
    moved: int = 0
    added: int = 0
    removed: int = 0
    missing_tracked: int = 0
    # Confluence отклонил креды на одном из спейсов: сверка проекта прервана,
    # накопленные счётчики валидны. Пометка кред — дело вызывающего.
    auth_failed: bool = False


async def sync_project_tree(
    db: AsyncSession,
    project: Project,
    conn: ConfluenceConnection,
    added_by: uuid.UUID,
) -> TreeSyncStats:
    """Сверить дерево одного проекта; added_by — автор новых виртуальных страниц.

    Спейсы проекта отдельно не ведутся — их определяют отслеживаемые (real)
    страницы: виртуальные существуют только рядом с отслеживаемой в том же
    спейсе. Ошибка загрузки отдельного спейса (кроме отказа кред) пропускает
    его и не прерывает сверку.
    """
    stats = TreeSyncStats()

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

    for space_key in space_keys:
        try:
            space_pages = await confluence.fetch_space_pages(space_key, conn)
        except ConfluenceAuthError:
            stats.auth_failed = True
            return stats
        except Exception as e:
            logger.warning("sync-tree: failed to fetch space %s: %s — skipping", space_key, e)
            continue

        stats.spaces += 1
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
                    stats.moved += 1
                if page.title != sp.title:
                    page.title = sp.title
            elif page.is_virtual:
                # Virtual placeholder gone from Confluence — safe to drop.
                await db.delete(page)
                stats.removed += 1
            else:
                # Tracked page with real data — keep it, just flag it.
                stats.missing_tracked += 1

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
                    added_by=added_by,
                ))
                stats.added += 1

        await db.flush()

    return stats
