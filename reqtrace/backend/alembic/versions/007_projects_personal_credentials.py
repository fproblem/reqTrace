"""Мультипроектность и личные креды (v1.5.1): projects, project_credentials,
pages.project_id; таблица settings упраздняется.

Revision ID: 007
Revises: 006
Create Date: 2026-07-03

Данные переносятся, не теряются:
- демо-страницы (confluence_page_id LIKE 'demo-%') раскладываются по личным
  демо-проектам их создателей («Демо — <имя>», is_demo=true, без кред);
- остальные страницы привязываются к проекту «Основной», его
  confluence_base_url/jira_base_url берутся из старой таблицы settings;
- глобальный пароль из settings НЕ переносится (он общий и хранился открытым
  текстом) — после релиза каждый участник вводит свои креды в настройках.

Downgrade — точка отката релиза: воссоздаёт settings и возвращает в неё
confluence_base_url/jira_base_url из «Основного». Пароль невосстановим —
после отката его нужно ввести в настройках заново.
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # --- 1. Таблицы проектов ---
    op.create_table(
        "projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("confluence_base_url", sa.Text, nullable=False, server_default=""),
        sa.Column("jira_base_url", sa.Text, nullable=True),
        sa.Column("is_demo", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("uq_projects_name_lower", "projects", [sa.text("lower(name)")], unique=True)

    op.create_table(
        "project_credentials",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("confluence_username", sa.String(255), nullable=False),
        sa.Column("confluence_password_enc", sa.Text, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="unchecked"),
        sa.Column("last_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_credentials_project_user"),
    )
    op.create_index("ix_project_credentials_project_id", "project_credentials", ["project_id"])
    op.create_index("ix_project_credentials_user_id", "project_credentials", ["user_id"])

    # --- 2. pages.project_id: nullable → backfill → NOT NULL ---
    op.add_column("pages", sa.Column("project_id", UUID(as_uuid=True),
                                     sa.ForeignKey("projects.id"), nullable=True))

    # 2а. Демо-страницы → личные демо-проекты создателей. В «Основном» они были
    # бы навсегда недоступны: доступ туда только по работающим кредам Confluence,
    # а у демо-страниц сервера нет.
    demo_owners = conn.execute(sa.text(
        "SELECT DISTINCT p.added_by, u.name FROM pages p "
        "JOIN users u ON u.id = p.added_by "
        "WHERE p.confluence_page_id LIKE 'demo-%'"
    )).fetchall()
    for owner_id, owner_name in demo_owners:
        demo_project_id = str(uuid.uuid4())
        conn.execute(sa.text(
            "INSERT INTO projects (id, name, confluence_base_url, jira_base_url, is_demo, created_by) "
            "VALUES (:id, :name, '', NULL, true, :owner)"
        ), {"id": demo_project_id, "name": f"Демо — {owner_name}", "owner": str(owner_id)})
        conn.execute(sa.text(
            "UPDATE pages SET project_id = :pid "
            "WHERE confluence_page_id LIKE 'demo-%' AND added_by = :owner"
        ), {"pid": demo_project_id, "owner": str(owner_id)})

    # 2б. Остальные страницы → проект «Основной» с URL'ами из старой settings.
    remaining = conn.execute(sa.text(
        "SELECT count(*) FROM pages WHERE project_id IS NULL"
    )).scalar()
    if remaining:
        def _setting(key: str) -> str:
            value = conn.execute(
                sa.text("SELECT value FROM settings WHERE key = :k"), {"k": key}
            ).scalar()
            return (value or "").strip().rstrip("/")

        earliest_user = conn.execute(sa.text(
            "SELECT id FROM users ORDER BY created_at ASC LIMIT 1"
        )).scalar()
        main_project_id = str(uuid.uuid4())
        conn.execute(sa.text(
            "INSERT INTO projects (id, name, confluence_base_url, jira_base_url, is_demo, created_by) "
            "VALUES (:id, 'Основной', :base, :jira, false, :owner)"
        ), {
            "id": main_project_id,
            "base": _setting("confluence_base_url"),
            "jira": _setting("jira_base_url") or None,
            "owner": str(earliest_user),
        })
        conn.execute(sa.text(
            "UPDATE pages SET project_id = :pid WHERE project_id IS NULL"
        ), {"pid": main_project_id})

    op.alter_column("pages", "project_id", nullable=False)
    op.create_index("ix_pages_project_id", "pages", ["project_id"])

    # 2в. Уникальность confluence_page_id: глобальная → в пределах проекта.
    op.drop_constraint("pages_confluence_page_id_key", "pages", type_="unique")
    op.create_unique_constraint(
        "uq_pages_project_confluence_page_id", "pages", ["project_id", "confluence_page_id"]
    )

    # --- 3. Глобальные настройки упразднены (креды теперь личные, в проектах) ---
    op.drop_index("ix_settings_key", table_name="settings")
    op.drop_table("settings")


def downgrade() -> None:
    conn = op.get_bind()

    # --- 1. Вернуть settings и восстановить URL'ы из «Основного» ---
    op.create_table(
        "settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(128), unique=True, nullable=False),
        sa.Column("value", sa.Text, nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_settings_key", "settings", ["key"])

    main_row = conn.execute(sa.text(
        "SELECT confluence_base_url, jira_base_url FROM projects "
        "WHERE is_demo = false AND lower(name) = lower('Основной') LIMIT 1"
    )).fetchone()
    if main_row is None:
        main_row = conn.execute(sa.text(
            "SELECT confluence_base_url, jira_base_url FROM projects "
            "WHERE is_demo = false ORDER BY created_at ASC LIMIT 1"
        )).fetchone()
    if main_row:
        for key, value in (
            ("confluence_base_url", main_row[0]),
            ("jira_base_url", main_row[1]),
        ):
            conn.execute(sa.text(
                "INSERT INTO settings (id, key, value) VALUES (:id, :k, :v)"
            ), {"id": str(uuid.uuid4()), "k": key, "v": value or ""})

    # --- 2. pages: составная уникальность → глобальная ---
    # Упадёт, если одна Confluence-страница заведена в двух проектах, — тогда
    # перед откатом нужно удалить одну из копий.
    op.drop_constraint("uq_pages_project_confluence_page_id", "pages", type_="unique")
    op.create_unique_constraint("pages_confluence_page_id_key", "pages", ["confluence_page_id"])
    op.drop_index("ix_pages_project_id", table_name="pages")
    op.drop_column("pages", "project_id")

    # --- 3. Снести таблицы проектов ---
    op.drop_table("project_credentials")
    op.drop_index("uq_projects_name_lower", table_name="projects")
    op.drop_table("projects")
