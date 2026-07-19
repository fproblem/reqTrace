"""Синхронизация названий тестов из Jira (v1.7.0, план — jira-test-names-plan-v1.7.md).

Названия актуализируются по аналогии со страницами: мгновенный точечный
fetch при привязке (кредами инициатора — заодно честная валидация «такой
тест существует») и ночная батч-синхронизация в прогоне проекта. Всё —
строго best effort: любая неудача не трогает ни привязку, ни журнал прогона.

Правило перезаписи: ok перезаписывает всё; not_found/error НЕ затирают
добытый ранее summary — права участников в Jira различаются, и бесправный
не должен «стереть» имя, которое видит коллега.
"""
import logging
from datetime import datetime, timezone

from cryptography.fernet import InvalidToken
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto import decrypt_secret
from app.models.highlight import Highlight
from app.models.highlight_test import HighlightTest
from app.models.page import Page
from app.models.project import Project, ProjectCredential
from app.models.test_detail import TestDetail
from app.services import jira
from app.services.jira import JiraAuthError, is_likely_jira_key

logger = logging.getLogger(__name__)

# Потолок точечных дозапросов за ночь: батч не вернул ключ (переехал или
# удалён) — добираем по одному, но не бесконечно.
MAX_POINT_FETCHES = 25


def _norm(key: str) -> str:
    return (key or "").strip().upper()


async def upsert_test_detail(
    db: AsyncSession, project_id, key: str, summary: str | None, result: str,
) -> None:
    key = _norm(key)
    row = (await db.execute(
        select(TestDetail).where(
            TestDetail.project_id == project_id, TestDetail.test_key == key,
        )
    )).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        db.add(TestDetail(
            project_id=project_id, test_key=key,
            summary=summary, fetch_result=result, fetched_at=now,
        ))
        return
    if result == "ok":
        row.summary = summary
        row.fetch_result = "ok"
        row.fetched_at = now
    elif row.fetch_result == "ok" and row.summary:
        # not_found/error не затирают имя (см. шапку модуля).
        return
    else:
        row.fetch_result = result
        row.fetched_at = now


def _cred_token(cred: ProjectCredential | None) -> str | None:
    """Расшифрованный токен участника — если он есть и не помечен invalid."""
    if cred is None or not cred.jira_token_enc or cred.jira_token_status == "invalid":
        return None
    try:
        return decrypt_secret(cred.jira_token_enc)
    except InvalidToken:
        return None


async def fetch_name_on_link(
    db: AsyncSession, project: Project, cred: ProjectCredential | None, key: str,
) -> tuple[str | None, bool | None]:
    """Мгновенный fetch при привязке: (summary, found).

    found None — проверка не выполнялась (нет Jira URL / токена / ключ не
    похож на Jira); False — Jira ответила «нет такой задачи» (валидация
    опечатки прямо в момент привязки); сама привязка создаётся в любом
    случае — решает человек.
    """
    key = _norm(key)
    token = _cred_token(cred)
    if not project.jira_base_url or token is None or not is_likely_jira_key(key):
        return None, None
    try:
        summary, result = await jira.fetch_summary(project.jira_base_url, token, key)
    except JiraAuthError:
        cred.jira_token_status = "invalid"
        await db.flush()
        return None, None
    except Exception:
        logger.warning("jira: не удалось получить название %s", key, exc_info=True)
        return None, None
    await upsert_test_detail(db, project.id, key, summary, result)
    await db.flush()
    return summary, result == "ok"


async def load_summaries(db: AsyncSession, project_id) -> dict[str, str]:
    """Известные названия тестов проекта: ключ → summary."""
    rows = (await db.execute(
        select(TestDetail).where(TestDetail.project_id == project_id)
    )).scalars().all()
    return {row.test_key: row.summary for row in rows if row.summary}


async def sync_project_test_names(session_factory, project: Project) -> int:
    """Ночная синхронизация названий проекта; возвращает число обновлённых.

    Ключи — DISTINCT по привязкам проекта (только похожие на Jira); токен —
    первого участника с рабочим; батч + точечный добор для «переехавших»;
    ретеншн осиротевших ключей. 401 метит токен invalid и передаёт ход
    следующему участнику; сеть/прочее — молча до следующей ночи.
    """
    if not project.jira_base_url:
        return 0

    async with session_factory() as db:
        key_rows = (await db.execute(
            select(HighlightTest.test_key)
            .join(Highlight, Highlight.id == HighlightTest.highlight_id)
            .join(Page, Page.id == Highlight.page_id)
            .where(Page.project_id == project.id)
            .distinct()
        )).all()
        keys = sorted({_norm(k) for (k,) in key_rows if is_likely_jira_key(_norm(k))})

        # Ретеншн: ключи без единой привязки больше не наши.
        prune = delete(TestDetail).where(TestDetail.project_id == project.id)
        if keys:
            prune = prune.where(TestDetail.test_key.not_in(keys))
        await db.execute(prune)
        await db.commit()

        if not keys:
            return 0

        creds = list((await db.execute(
            select(ProjectCredential).where(
                ProjectCredential.project_id == project.id,
                ProjectCredential.status == "ok",
                ProjectCredential.jira_token_enc.isnot(None),
            ).order_by(ProjectCredential.last_check_at.desc().nulls_last())
        )).scalars().all())

        for cred in creds:
            token = _cred_token(cred)
            if token is None:
                continue
            try:
                found = await jira.fetch_summaries(project.jira_base_url, token, keys)
                point_results: dict[str, tuple[str | None, str]] = {}
                missing = [k for k in keys if k not in found]
                for key in missing[:MAX_POINT_FETCHES]:
                    point_results[key] = await jira.fetch_summary(
                        project.jira_base_url, token, key,
                    )
            except JiraAuthError:
                cred.jira_token_status = "invalid"
                await db.commit()
                continue  # ход следующему участнику с токеном
            except Exception:
                logger.warning(
                    "jira: синхронизация названий «%s» не удалась (сеть) — до следующей ночи",
                    project.name, exc_info=True,
                )
                return 0

            for key, summary in found.items():
                await upsert_test_detail(db, project.id, key, summary, "ok")
            for key, (summary, result) in point_results.items():
                await upsert_test_detail(db, project.id, key, summary, result)
            await db.commit()
            return len(found) + len(point_results)

    return 0
