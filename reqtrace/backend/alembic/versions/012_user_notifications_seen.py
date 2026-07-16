"""Отметка «колокольчик открыт» (v1.6.3): users.notifications_seen_at.

Уведомления — представление журнала refresh_runs по членству пользователя;
единственное персональное состояние — момент последнего открытия панели:
записи новее отметки считаются непрочитанными (бейдж на колокольчике).

Revision ID: 012
Revises: 011
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("notifications_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "notifications_seen_at")
