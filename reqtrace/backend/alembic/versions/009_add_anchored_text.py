"""Текущий текст под маркером (v1.5.9): highlights.anchored_text.

Модель «маркер в снимке» (anchoring-plan-v1.5.9.md): text_content становится
замороженной цитатой (аналог inlineOriginalSelection у Confluence), а
anchored_text хранит текущий текст под якорем в актуальном снимке —
пересчитывается движком anchoring при каждом refresh. NULL — привязка ещё не
проходила через новый конвейер; читатели используют text_content как фолбэк.
Бэкфилл не нужен: якоря привязок уже поддерживаются актуальными снимку
(v1.5.8), первый же refresh заполнит колонку.

Revision ID: 009
Revises: 008
Create Date: 2026-07-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("highlights", sa.Column("anchored_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("highlights", "anchored_text")
