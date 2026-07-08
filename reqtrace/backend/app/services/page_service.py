"""Сервис страниц: обновление содержимого из Confluence и перенос привязок.

Вынесен из routers/pages.py (этап 2 плана v1.5.9): роутер остаётся тонким
HTTP-слоем, а конвейер refresh тестируется без HTTP и живого Confluence.

Перенос привязок — модель «маркер в снимке» (services/anchoring.py): диапазон
привязки один раз переносится диффом «предыдущий снимок → новый», статусы
решает движок по утверждённой таблице (anchoring-plan-v1.5.9.md). Здесь —
только оркестрация: снимок, заголовок, место в дереве, запись результатов
проекции в ORM-объекты.
"""
import logging

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.highlight import Highlight
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.snapshot import PageSnapshot
from app.project_access import connection_for, render_page_html, run_confluence
from app.services import anchoring, confluence
from app.services.diff_engine import has_text_changed

logger = logging.getLogger(__name__)


def apply_projection(highlights: list[Highlight], old_html: str, new_html: str) -> None:
    """Переносит ORM-привязки на новую версию страницы (мутирует объекты).

    Оба html — ОБРАБОТАННЫЕ (render_page_html). Правила статусов живут в
    anchoring.project: «Утрачено» терминально (объект не трогается вовсе,
    якоря заморожены), выжившие получают новые якоря и anchored_text,
    refresh никогда не повышает статус.
    """
    hl_dicts = [
        {
            "id": h.id,
            "status": h.status,
            "text_content": h.text_content,
            "anchor_block_start": h.anchor_block_start,
            "anchor_block_end": h.anchor_block_end,
            "start_char_offset": h.start_char_offset,
            "end_char_offset": h.end_char_offset,
        }
        for h in highlights
    ]
    projected = anchoring.project(old_html, new_html, hl_dicts)
    for h, proj in zip(highlights, projected):
        if h.status == "lost":
            continue
        h.status = proj["projected_status"]
        if "new_anchor_block_start" in proj:
            h.anchor_block_start = proj["new_anchor_block_start"]
            h.anchor_block_end = proj["new_anchor_block_end"]
            h.start_char_offset = proj["new_start_char_offset"]
            h.end_char_offset = proj["new_end_char_offset"]
            h.anchored_text = proj.get("anchored_text")
        # Диапазон не выжил: статус стал lost, якоря и anchored_text
        # замораживаются в состоянии последнего живого снимка.
        logger.debug("Highlight '%s...' -> %s", (h.text_content or "")[:50], h.status)


async def latest_snapshot(db: AsyncSession, page_id) -> PageSnapshot | None:
    result = await db.execute(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page_id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def extract_anchored_text(rendered_html: str, highlight: Highlight) -> str | None:
    """Текущий текст под маркером привязки в ОБРАБОТАННОМ HTML снимка.

    None — якорь не указывает на валидный диапазон (анкорлесс-легаси или
    индекс за пределами документа).
    """
    if highlight.anchor_block_start is None:
        return None
    doc = anchoring.doc_from_html(rendered_html)
    rng = anchoring.abs_range(
        doc,
        highlight.anchor_block_start, highlight.anchor_block_end,
        highlight.start_char_offset or 0, highlight.end_char_offset or 0,
    )
    if rng is None:
        return None
    return doc.text[rng[0]:rng[1]]


def backfill_anchored_text(highlights: list[Highlight], rendered_html: str) -> None:
    """Одноразовое заполнение anchored_text у привязок из «до-v1.5.9» мира.

    Их якоря уже актуальны текущему снимку (v1.5.8 поддерживала их на каждом
    refresh), поэтому извлечение по координатам и есть текущий текст маркера.
    «Утраченные» не трогаем — их якоря заморожены и осмыслены только для
    прежнего снимка.
    """
    for h in highlights:
        if h.status == "lost" or h.anchored_text is not None:
            continue
        h.anchored_text = extract_anchored_text(rendered_html, h)


async def refresh_from_confluence(
    db: AsyncSession,
    page: Page,
    project: Project,
    cred: ProjectCredential | None,
) -> bool:
    """Тянет страницу из Confluence и, если текст изменился, создаёт снимок и
    переносит привязки на новую версию. Возвращает, изменилось ли содержимое.
    """
    conn = connection_for(project, cred)
    try:
        page_data = await run_confluence(
            db, project, cred, confluence.fetch_page(page.confluence_page_id, conn)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from Confluence: {e}")

    # Место страницы в дереве — до раннего выхода «контент не изменился»:
    # перемещение страницы в Confluence меняет предков, не трогая содержимого
    # (get_db закоммитит изменение в любом случае).
    new_parent = page_data.ancestors[-1].page_id if page_data.ancestors else None
    if page.parent_confluence_page_id != new_parent:
        page.parent_confluence_page_id = new_parent

    prev_snapshot = await latest_snapshot(db, page.id)
    if prev_snapshot and not has_text_changed(prev_snapshot.content_html, page_data.content_html):
        # Содержимое не менялось, но у привязок из «до-v1.5.9» мира могло быть
        # не заполнено anchored_text — заполняем, чтобы «Актуализировать» и
        # панель работали не дожидаясь первой реальной правки страницы.
        hl_result = await db.execute(select(Highlight).where(Highlight.page_id == page.id))
        highlights = hl_result.scalars().all()
        if any(h.status != "lost" and h.anchored_text is None for h in highlights):
            rendered = render_page_html(prev_snapshot.content_html, page.id, project) or ""
            backfill_anchored_text(highlights, rendered)
            await db.flush()
        return False

    db.add(PageSnapshot(
        page_id=page.id,
        confluence_version=page_data.version,
        content_html=page_data.content_html,
    ))
    await db.flush()

    page.title = page_data.title

    hl_result = await db.execute(select(Highlight).where(Highlight.page_id == page.id))
    highlights = hl_result.scalars().all()

    # Привязки без предыдущего снимка невозможны (создание требует снимка);
    # если его вдруг нет — переносить не с чего, привязки не трогаем.
    if highlights and prev_snapshot:
        # Проекция — строго в координатах ОБРАБОТАННОГО HTML (render_page_html):
        # именно по нему фронт считает якоря и рисует страницу (см. v1.5.6).
        rendered_new = render_page_html(page_data.content_html, page.id, project) or ""
        rendered_old = render_page_html(prev_snapshot.content_html, page.id, project) or ""
        apply_projection(highlights, rendered_old, rendered_new)

    await db.flush()
    return True
