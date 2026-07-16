"""Журнал прогонов автообновления (v1.6.2): refresh_runs.

Ночной прогон refresh по всем проектам журналируется построчно (строка =
прогон одного проекта): счётчики страниц и переходов статусов привязок,
итоги sync-tree, пер-страничные подробности и проблемы кред — JSON'ом.
Журнал — источник и для утреннего дайджеста (v1.6.3): уведомления строятся
выборкой по членству, рассылок нет. План — auto-refresh-plan-v1.6.md.

Revision ID: 011
Revises: 010
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "refresh_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("trigger", sa.String(16), nullable=False, server_default="auto"),
        sa.Column("status", sa.String(16), nullable=False, server_default="skipped"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pages_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages_changed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("to_outdated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("to_lost", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tree_added", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tree_moved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tree_removed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tree_missing_tracked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        sa.Column("cred_issues", postgresql.JSONB(), nullable=True),
    )
    op.create_index("ix_refresh_runs_project_id", "refresh_runs", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_refresh_runs_project_id", table_name="refresh_runs")
    op.drop_table("refresh_runs")
