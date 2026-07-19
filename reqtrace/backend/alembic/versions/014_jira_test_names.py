"""Названия тестов из Jira (v1.7.0): test_details + личный Jira-токен.

ReqTrace читает из Jira ТОЛЬКО summary задач (план —
jira-test-names-plan-v1.7.md). Токен — PAT участника (Bearer), опционален,
шифруется тем же Fernet(CREDENTIALS_KEY), что пароль Confluence.

Revision ID: 014
Revises: 013
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_credentials",
        sa.Column("jira_token_enc", sa.Text(), nullable=True),
    )
    op.add_column(
        "project_credentials",
        sa.Column("jira_token_status", sa.String(length=16), nullable=True),
    )
    op.create_table(
        "test_details",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("test_key", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("fetch_result", sa.String(length=16), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "test_key", name="uq_test_details_project_key"),
    )
    op.create_index("ix_test_details_project_id", "test_details", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_test_details_project_id", table_name="test_details")
    op.drop_table("test_details")
    op.drop_column("project_credentials", "jira_token_status")
    op.drop_column("project_credentials", "jira_token_enc")
