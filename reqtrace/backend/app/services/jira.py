"""Jira: ТОЛЬКО чтение названий тестов (v1.7.0, план — jira-test-names-plan-v1.7.md).

Контракт модуля — границы, заданные пользователем: ReqTrace ходит в Jira
исключительно за summary задач. Здесь есть и может быть ТОЛЬКО GET; никакого
создания, редактирования или переходов задач из ReqTrace не существует.

Аутентификация — личный токен (PAT, Jira DC 8.14+): Authorization: Bearer.
Токен не является паролем LDAP, отзывается в профиле Jira и не грозит
CAPTCHA-блокировкой входа при неудачах (в отличие от Basic-перебора —
поэтому Basic здесь сознательно не поддержан).
"""
import logging
import re
import urllib.parse

import httpx

logger = logging.getLogger(__name__)

FETCH_TIMEOUT = 15.0
# Партия батч-поиска: с непустым fields Jira отдаёт максимум 100 задач на
# страницу — режем сами, чтобы не связываться с пагинацией.
BATCH_SIZE = 100

# Серверное зеркало isLikelyJiraKey (frontend testKeyFormat.ts): латинский
# PROJECT-123. Непохожие ключи в Jira не запрашиваются вовсе.
_JIRA_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]*-\d+$")


def is_likely_jira_key(key: str) -> bool:
    return bool(_JIRA_KEY_RE.match((key or "").strip().upper()))


class JiraAuthError(Exception):
    """Jira отклонила токен (401/403) — пометить jira_token_status=invalid."""


class JiraUnavailableError(Exception):
    """Jira недоступна или ответила неожиданно — попробуем в другой раз."""


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


async def _get(url: str, token: str, params: dict | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
        return await client.get(url, params=params, headers=_headers(token))


async def check_token(base_url: str, token: str, *, get=_get) -> str:
    """Живая проверка токена: GET /myself. Возвращает displayName владельца.

    401/403 → JiraAuthError; всё прочее «не 200» → JiraUnavailableError.
    """
    resp = await get(f"{base_url}/rest/api/2/myself", token)
    if resp.status_code in (401, 403):
        raise JiraAuthError(resp.status_code)
    if resp.status_code != 200:
        raise JiraUnavailableError(f"myself: HTTP {resp.status_code}")
    data = resp.json()
    return data.get("displayName") or data.get("name") or ""


async def fetch_summary(
    base_url: str, token: str, key: str, *, get=_get,
) -> tuple[str | None, str]:
    """Название одной задачи: (summary, result), result — ok | not_found.

    Точечный GET находит и «переехавшие» задачи (запрос по старому ключу
    отдаёт задачу с новым key) — сохраняем под ЗАПРОШЕННЫМ ключом: привязки
    живут по нему.
    """
    enc = urllib.parse.quote(key, safe="")
    resp = await get(
        f"{base_url}/rest/api/2/issue/{enc}", token, params={"fields": "summary"},
    )
    if resp.status_code in (401, 403):
        raise JiraAuthError(resp.status_code)
    if resp.status_code == 404:
        return None, "not_found"
    if resp.status_code != 200:
        raise JiraUnavailableError(f"issue {key}: HTTP {resp.status_code}")
    summary = (resp.json().get("fields") or {}).get("summary")
    return (summary, "ok") if summary else (None, "not_found")


async def fetch_summaries(
    base_url: str, token: str, keys: list[str], *, get=_get,
) -> dict[str, str]:
    """Названия пачки задач батч-поиском; ключи без ответа в словарь не входят.

    validateQuery=false обязателен: без него один несуществующий ключ в
    `issuekey in (…)` роняет весь запрос ошибкой 400. «Переехавшие» задачи
    Jira возвращает с НОВЫМ ключом — они в ответе не сматчатся с запрошенным
    и останутся «без ответа»; вызывающий добирает их точечными fetch_summary
    (который по старому ключу работает).
    """
    result: dict[str, str] = {}
    for start in range(0, len(keys), BATCH_SIZE):
        batch = keys[start:start + BATCH_SIZE]
        jql = f"issuekey in ({', '.join(batch)})"
        resp = await get(
            f"{base_url}/rest/api/2/search", token,
            params={
                "jql": jql,
                "fields": "summary",
                "maxResults": str(BATCH_SIZE),
                "validateQuery": "false",
            },
        )
        if resp.status_code in (401, 403):
            raise JiraAuthError(resp.status_code)
        if resp.status_code != 200:
            # Батч не задался (например, строгая Jira игнорирует
            # validateQuery) — вызывающий добёрет точечными запросами.
            logger.warning("jira: батч-поиск вернул HTTP %d", resp.status_code)
            continue
        wanted = {k.upper() for k in batch}
        for issue in resp.json().get("issues", []):
            issue_key = (issue.get("key") or "").upper()
            summary = (issue.get("fields") or {}).get("summary")
            if issue_key in wanted and summary:
                result[issue_key] = summary
    return result
