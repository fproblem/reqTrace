"""Исход последней проверки кред (v1.5.2): project_credentials.last_check_result.

Недоступность Confluence (VPN, сеть) раньше не оставляла следа — карточка
проекта продолжала показывать «Подключено · проверено <дата>». Новая колонка
хранит исход последней попытки проверки: ok | invalid | unreachable.
На доступ к контенту влияет по-прежнему только status.

Revision ID: 008
Revises: 007
Create Date: 2026-07-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_credentials",
        sa.Column("last_check_result", sa.String(16), nullable=True),
    )
    # Бэкфилл: у кого проверка уже была, её исход совпадает со статусом.
    op.execute(
        "UPDATE project_credentials SET last_check_result = status "
        "WHERE last_check_at IS NOT NULL AND status IN ('ok', 'invalid')"
    )


def downgrade() -> None:
    op.drop_column("project_credentials", "last_check_result")
