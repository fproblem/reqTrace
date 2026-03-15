"""Add block-based anchoring to highlights

Revision ID: 003
Revises: 002
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("highlights", sa.Column("anchor_block_start", sa.Integer, nullable=True))
    op.add_column("highlights", sa.Column("anchor_block_end", sa.Integer, nullable=True))
    op.add_column("highlights", sa.Column("start_char_offset", sa.Integer, nullable=True))
    op.add_column("highlights", sa.Column("end_char_offset", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("highlights", "end_char_offset")
    op.drop_column("highlights", "start_char_offset")
    op.drop_column("highlights", "anchor_block_end")
    op.drop_column("highlights", "anchor_block_start")
