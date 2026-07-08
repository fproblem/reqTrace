"""Тесты HTTP-слоя привязок (v1.5.9): создание с верификацией якоря и
«Актуализировать» без поиска текста.

Провод через роутер на демо-проекте (без кред — доступ по создателю, БД
заменена стабом). Правила самого движка — в test_anchoring.
"""
import unittest
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi.testclient import TestClient

from app.auth import JWT_ALGORITHM, SESSION_COOKIE_NAME
from app.config import settings
from app.database import get_db
from app.main import app
from app.models.highlight import Highlight
from app.models.page import Page
from app.models.project import Project
from app.models.snapshot import PageSnapshot
from app.models.user import User
from app.services.anchoring import doc_from_html
from app.services.confluence import process_confluence_html

PAGE_HTML = (
    "<p>Шапка раздела</p>"
    "<p>Текст под подзаголовок четвертого уровня.</p>"
    "<p>Хвостовой абзац</p>"
)


class _StubResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _StubSession:
    """Минимум AsyncSession для флоу highlights: get() по (модель, pk),
    единственный execute() — выборка последнего снимка, add() запоминает
    объект и заполняет серверные дефолты (created_at)."""

    def __init__(self, objects, snapshot):
        self.objects = objects
        self.snapshot = snapshot
        self.added = []

    async def get(self, model, pk, options=None):
        return self.objects.get((model, pk))

    def add(self, obj):
        # Серверные/колоночные дефолты реальной БД (id, created_at) стаб
        # проставляет сам — INSERT здесь не случается.
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)
        self.added.append(obj)

    async def execute(self, stmt):
        return _StubResult(self.snapshot)

    async def flush(self):
        pass

    async def refresh(self, obj, attrs=None):
        pass


class HighlightsApiCase(unittest.TestCase):
    def setUp(self):
        self._old_secret = settings.SESSION_SECRET
        settings.SESSION_SECRET = "test-session-secret"

        self.user = User(name="QA Surf", email="qa@surf.dev")
        self.user.id = uuid.uuid4()

        self.project = Project(
            name="Демо — QA", confluence_base_url="", jira_base_url="",
            is_demo=True, created_by=self.user.id,
        )
        self.project.id = uuid.uuid4()

        self.page = Page(
            project_id=self.project.id, confluence_page_id="demo-1",
            confluence_url="https://conf.example.com/pages/viewpage.action?pageId=1",
            title="Требования", space_key="DEMO", added_by=self.user.id,
        )
        self.page.id = uuid.uuid4()

        self.snapshot = PageSnapshot(
            page_id=self.page.id, confluence_version=1, content_html=PAGE_HTML,
        )
        self.snapshot.id = uuid.uuid4()

        # Цитата и координаты — в пространстве ОБРАБОТАННОГО HTML.
        processed = process_confluence_html(PAGE_HTML, str(self.page.id))
        self.doc = doc_from_html(processed)
        self.quote = self.doc.blocks[1]

        self.objects = {
            (User, self.user.id): self.user,
            (Page, self.page.id): self.page,
            (Project, self.project.id): self.project,
        }
        self.session = _StubSession(self.objects, self.snapshot)
        app.dependency_overrides[get_db] = lambda: self.session
        self.client = TestClient(app)
        payload = {
            "sub": str(self.user.id),
            "email": self.user.email,
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        }
        self.client.cookies.set(
            SESSION_COOKIE_NAME,
            jwt.encode(payload, settings.SESSION_SECRET, algorithm=JWT_ALGORITHM),
        )

    def tearDown(self):
        app.dependency_overrides.clear()
        settings.SESSION_SECRET = self._old_secret

    def make_highlight(self, **over) -> Highlight:
        h = Highlight(
            page_id=self.page.id, snapshot_id=self.snapshot.id,
            start_xpath="", start_offset=0, end_xpath="", end_offset=0,
            text_content=over.pop("text_content", self.quote),
            text_before="", text_after="",
            anchor_block_start=over.pop("anchor_block_start", 1),
            anchor_block_end=over.pop("anchor_block_end", 1),
            start_char_offset=over.pop("start_char_offset", 0),
            end_char_offset=over.pop("end_char_offset", len(self.quote)),
            status=over.pop("status", "outdated"),
            created_by=self.user.id,
        )
        h.id = uuid.uuid4()
        h.created_at = datetime.now(timezone.utc)
        for k, v in over.items():
            setattr(h, k, v)
        self.objects[(Highlight, h.id)] = h
        return h


class CreateHighlight(HighlightsApiCase):
    def payload(self, **over):
        p = {
            "text_content": self.quote,
            "text_before": "Шапка раздела",
            "text_after": "Хвостовой абзац",
            "anchor_block_start": 1,
            "anchor_block_end": 1,
            "start_char_offset": 0,
            "end_char_offset": len(self.quote),
        }
        p.update(over)
        return p

    def test_valid_anchor_creates_outdated_with_anchored_text(self):
        resp = self.client.post(
            f"/api/pages/{self.page.id}/highlights", json=self.payload()
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["status"], "outdated")
        self.assertEqual(data["anchored_text"], self.quote)
        self.assertEqual(data["anchor_block_start"], 1)

    def test_quote_mismatch_rejected_409(self):
        resp = self.client.post(
            f"/api/pages/{self.page.id}/highlights",
            json=self.payload(text_content="Совсем другой текст"),
        )
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(self.session.added, [])

    def test_anchorless_selection_rejected_400(self):
        resp = self.client.post(
            f"/api/pages/{self.page.id}/highlights",
            json=self.payload(anchor_block_start=None, anchor_block_end=None),
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.session.added, [])


class ReanchorHighlight(HighlightsApiCase):
    def test_confirms_anchored_text_as_new_quote(self):
        # Обычный случай: refresh уже записал изменившийся текст под маркером.
        h = self.make_highlight(
            text_content="Старая цитата до правки страницы.",
            anchored_text=self.quote,
        )
        resp = self.client.post(f"/api/highlights/{h.id}/reanchor")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["status"], "active")
        self.assertEqual(data["text_content"], self.quote)
        self.assertEqual(data["anchored_text"], self.quote)

    def test_pre_v159_highlight_extracts_by_anchor(self):
        # anchored_text ещё не заполнен (мир до миграции 009): текст берётся
        # по якорям из актуального снимка — БЕЗ поиска по странице.
        h = self.make_highlight(text_content="Старая цитата до правки.")
        resp = self.client.post(f"/api/highlights/{h.id}/reanchor")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["text_content"], self.quote)

    def test_broken_anchor_refused_409_untouched(self):
        h = self.make_highlight(
            text_content="Старая цитата.",
            anchor_block_start=99, anchor_block_end=99,
        )
        resp = self.client.post(f"/api/highlights/{h.id}/reanchor")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(h.text_content, "Старая цитата.")
        self.assertEqual(h.status, "outdated")

    def test_only_outdated_can_be_reanchored(self):
        h = self.make_highlight(status="active", anchored_text=self.quote)
        resp = self.client.post(f"/api/highlights/{h.id}/reanchor")
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
