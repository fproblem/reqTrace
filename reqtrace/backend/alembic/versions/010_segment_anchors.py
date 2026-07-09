"""Сегментная модель якорей (v1.5.9): перенумерация блочных индексов.

Документная модель расширена: собственный текст родительских пунктов списка /
ячеек с вложенными блоками стал отдельными сегментами (раньше он вообще не
попадал в модель, и выделения на нём были невозможны). Из-за вставки таких
сегментов индексы листовых блоков сдвигаются — якоря существующих привязок
пересчитываются по актуальному снимку их страницы: старый индекс k листового
блока → новый индекс k-го листового сегмента. Смещения внутри блока не
меняются (текст листовых сегментов идентичен старым блокам).

«Утраченные» привязки не трогаем: их якоря заморожены под прежний снимок и
в новой модели не используются (статус терминальный).

Downgrade: обратная перенумерация; привязки, созданные УЖЕ на нелистовых
сегментах, обратного образа не имеют — их якоря обнуляются (привязка при
следующем refresh честно уйдёт в «Утрачено»).

Revision ID: 010
Revises: 009
Create Date: 2026-07-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.services.anchoring import leaf_segment_indexes
from app.services.confluence import process_confluence_html

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _latest_snapshots(conn):
    """id страницы → content_html последнего снимка."""
    rows = conn.execute(sa.text("""
        SELECT DISTINCT ON (page_id) page_id, content_html
        FROM page_snapshots
        ORDER BY page_id, fetched_at DESC
    """)).fetchall()
    return {r[0]: r[1] for r in rows}


def _remap(conn, forward: bool) -> None:
    snapshots = _latest_snapshots(conn)
    highlights = conn.execute(sa.text("""
        SELECT id, page_id, anchor_block_start, anchor_block_end
        FROM highlights
        WHERE status != 'lost' AND anchor_block_start IS NOT NULL
    """)).fetchall()

    mapping_cache: dict = {}
    for hl_id, page_id, start, end in highlights:
        html = snapshots.get(page_id)
        if html is None:
            continue
        if page_id not in mapping_cache:
            leaves = leaf_segment_indexes(process_confluence_html(html, str(page_id)))
            mapping_cache[page_id] = leaves
        leaves = mapping_cache[page_id]

        if forward:
            # старый листовой индекс → новый сегментный
            new_start = leaves[start] if 0 <= start < len(leaves) else None
            new_end = leaves[end] if end is not None and 0 <= end < len(leaves) else new_start
        else:
            # новый сегментный → старый листовой (нелистовые — без образа)
            back = {seg: k for k, seg in enumerate(leaves)}
            new_start = back.get(start)
            new_end = back.get(end) if end is not None else new_start

        if new_start is None:
            conn.execute(sa.text("""
                UPDATE highlights SET anchor_block_start = NULL, anchor_block_end = NULL,
                    start_char_offset = NULL, end_char_offset = NULL
                WHERE id = :id
            """), {"id": hl_id})
        else:
            conn.execute(sa.text("""
                UPDATE highlights SET anchor_block_start = :s, anchor_block_end = :e
                WHERE id = :id
            """), {"id": hl_id, "s": new_start, "e": new_end})


def upgrade() -> None:
    _remap(op.get_bind(), forward=True)


def downgrade() -> None:
    _remap(op.get_bind(), forward=False)
