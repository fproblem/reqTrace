"""Add parent_confluence_page_id and is_virtual to pages for tree hierarchy

Revision ID: 005
Revises: 004
Create Date: 2026-03-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("pages", sa.Column("parent_confluence_page_id", sa.String(64), nullable=True))
    op.add_column("pages", sa.Column("is_virtual", sa.Boolean(), server_default="false", nullable=False))
    op.create_index("ix_pages_parent_confluence_page_id", "pages", ["parent_confluence_page_id"])


def downgrade() -> None:
    op.drop_index("ix_pages_parent_confluence_page_id", table_name="pages")
    op.drop_column("pages", "is_virtual")
    op.drop_column("pages", "parent_confluence_page_id")
