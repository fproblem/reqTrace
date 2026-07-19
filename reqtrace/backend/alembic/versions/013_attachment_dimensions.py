"""Размеры картинок-вложений (v1.6.6): attachment_dimensions.

Браузер резервирует место под <img> только при известных размерах — без них
контент «едет» при первом открытии страницы. Размеры замеряет бэкенд при
снимке (Confluence присылает ac:width/height лишь у ресайзнутых картинок),
рендер подставляет их в HTML. width/height NULL = формат не распознан.

Revision ID: 013
Revises: 012
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "attachment_dimensions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(length=1024), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column(
            "measured_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "page_id", "filename", name="uq_attachment_dimensions_page_filename"
        ),
    )
    op.create_index(
        "ix_attachment_dimensions_page_id", "attachment_dimensions", ["page_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_attachment_dimensions_page_id", table_name="attachment_dimensions")
    op.drop_table("attachment_dimensions")
