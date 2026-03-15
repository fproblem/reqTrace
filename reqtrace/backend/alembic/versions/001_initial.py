"""Initial migration

Revision ID: 001
Revises:
Create Date: 2026-03-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "pages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("confluence_page_id", sa.String(64), unique=True, nullable=False),
        sa.Column("confluence_url", sa.Text, nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("space_key", sa.String(64), nullable=True),
        sa.Column("added_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "page_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("page_id", UUID(as_uuid=True), sa.ForeignKey("pages.id"), nullable=False),
        sa.Column("confluence_version", sa.Integer, nullable=False),
        sa.Column("content_html", sa.Text, nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "baselines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("page_id", UUID(as_uuid=True), sa.ForeignKey("pages.id"), nullable=False),
        sa.Column("snapshot_id", UUID(as_uuid=True), sa.ForeignKey("page_snapshots.id"), nullable=False),
        sa.Column("confirmed_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "highlights",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("page_id", UUID(as_uuid=True), sa.ForeignKey("pages.id"), nullable=False),
        sa.Column("snapshot_id", UUID(as_uuid=True), sa.ForeignKey("page_snapshots.id"), nullable=False),
        sa.Column("start_xpath", sa.Text, nullable=False),
        sa.Column("start_offset", sa.Integer, nullable=False),
        sa.Column("end_xpath", sa.Text, nullable=False),
        sa.Column("end_offset", sa.Integer, nullable=False),
        sa.Column("text_content", sa.Text, nullable=False),
        sa.Column("text_before", sa.String(100), nullable=True),
        sa.Column("text_after", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "highlight_tests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("highlight_id", UUID(as_uuid=True), sa.ForeignKey("highlights.id"), nullable=False),
        sa.Column("test_key", sa.String(64), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("highlight_tests")
    op.drop_table("highlights")
    op.drop_table("baselines")
    op.drop_table("page_snapshots")
    op.drop_table("pages")
    op.drop_table("users")
