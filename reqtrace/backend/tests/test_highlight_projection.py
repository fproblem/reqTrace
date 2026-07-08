"""Тесты «Актуализировать» (resolve_reanchor) и координатного пространства якорей.

Регрессия бага v1.5.6: якоря привязок фронт считает по ОБРАБОТАННОМУ HTML
(render_page_html), а бэкенд извлекал текст по сырому storage-XML снимка, где
текст ссылок/кода сидит в CDATA и невидим HTML-парсеру. «Актуализировать»
из-за этого молча и необратимо перезаписывала цитату чужим текстом со страницы
(терялся текст ссылки, хвост уезжал в соседний абзац).

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
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
from app.services.confluence import process_confluence_html
from app.services.highlight_projection import (
    extract_blocks,
    extract_text_at_anchor,
    project_highlights,
    resolve_reanchor,
)

# Мини-копия страницы из бага: абзац таблицы с Confluence-ссылкой (текст в
# CDATA) и следующий абзац, куда «уезжала» цитата при извлечении по сырому XML.
RAW_XML = (
    '<table><tbody><tr><td><p>Текст блока</p></td><td>'
    '<p>Значение параметра "first_block.text" из кэша '
    '<ac:link><ri:page ri:content-title="GET /v7/configuration" />'
    '<ac:plain-text-link-body><![CDATA[GET /v7/configuration]]></ac:plain-text-link-body>'
    '</ac:link></p>'
    '<p>Если параметр не пришел или равен null, то значение по дефолту</p>'
    '</td></tr></tbody></table>'
)


class AnchorCoordinateSpace(unittest.TestCase):
    """Блоки для якорей обязаны считаться по обработанному HTML."""

    def test_processed_blocks_keep_link_text(self):
        blocks = extract_blocks(process_confluence_html(RAW_XML, "p1"))
        self.assertIn("GET /v7/configuration", blocks[1])

    def test_raw_xml_hides_link_text(self):
        # Документирует, ПОЧЕМУ сырой storage-XML нельзя использовать для
        # якорей: текст ссылки в CDATA невидим парсеру, блок короче — все
        # смещения, посчитанные фронтом, в этом пространстве врут.
        raw_blocks = extract_blocks(RAW_XML)
        self.assertNotIn("GET /v7/configuration", raw_blocks[1])

    def test_extract_at_anchor_over_processed_html_returns_visible_text(self):
        html = process_confluence_html(RAW_XML, "p1")
        quote = extract_blocks(html)[1]
        extracted = extract_text_at_anchor(html, 1, 1, 0, len(quote))
        self.assertEqual(extracted["text_content"], quote)


class ResolveReanchorValidAnchor(unittest.TestCase):
    def setUp(self):
        self.html = process_confluence_html(RAW_XML, "p1")
        self.blocks = extract_blocks(self.html)
        self.quote = self.blocks[1]

    def test_valid_anchor_keeps_quote_and_anchors(self):
        r = resolve_reanchor(self.html, self.quote, "", "", 1, 1, 0, len(self.quote))
        self.assertIsNotNone(r)
        self.assertEqual(r["text_content"], self.quote)
        self.assertEqual(r["anchor_block_start"], 1)
        self.assertEqual(r["anchor_block_end"], 1)

    def test_whitespace_differences_are_tolerated(self):
        # selection.toString() вставляет переносы; цитата с другой вёрсткой
        # пробелов должна подтверждаться под якорем, а сохраняться — в том
        # виде, как текст лежит на странице.
        ragged = self.quote.replace(" из кэша ", "\nиз кэша\n")
        r = resolve_reanchor(self.html, ragged, "", "", 1, 1, 0, len(self.quote))
        self.assertIsNotNone(r)
        self.assertEqual(r["text_content"], self.quote)


class ResolveReanchorHealsDriftedAnchor(unittest.TestCase):
    """Сценарий реального бага: якорь съехал, цитата на странице целиком."""

    def setUp(self):
        self.html = process_confluence_html(RAW_XML, "p1")
        self.blocks = extract_blocks(self.html)
        self.quote = self.blocks[1]

    def test_drifted_anchor_is_recomputed_from_text(self):
        # Якорь указывает через два блока с обрезанным хвостом — раньше это
        # давало цитату «...из кэша Если парам» с чужим текстом.
        r = resolve_reanchor(self.html, self.quote, "", "", 1, 2, 0, 22)
        self.assertIsNotNone(r)
        self.assertEqual(r["text_content"], self.quote)
        self.assertEqual(r["anchor_block_start"], 1)
        self.assertEqual(r["anchor_block_end"], 1)
        self.assertEqual(r["start_char_offset"], 0)
        self.assertEqual(r["end_char_offset"], len(self.quote))

    def test_legacy_highlight_without_anchor_gets_anchors_from_text(self):
        r = resolve_reanchor(self.html, self.quote, "", "", None, None, 0, 0)
        self.assertIsNotNone(r)
        self.assertEqual(r["text_content"], self.quote)
        self.assertEqual(r["anchor_block_start"], 1)


class ResolveReanchorAmbiguity(unittest.TestCase):
    def test_repeated_quote_disambiguated_by_context(self):
        html = (
            "<p>Цена: 10 руб.</p><p>Скидка действует.</p><p>Цена: 10 руб.</p>"
        )
        r = resolve_reanchor(
            html, "Цена: 10 руб.", "Скидка действует.", "",
            None, None, 0, 0,
        )
        self.assertIsNotNone(r)
        self.assertEqual(r["anchor_block_start"], 2)


class ResolveReanchorSplit(unittest.TestCase):
    """Вставка внутрь выделения («разрыв», как инлайн-комментарий Confluence)."""

    def test_insertion_inside_quote_is_absorbed(self):
        html = "<p>Шапка</p><p>Первое правило. Вставка автора. Второе правило.</p>"
        quote = "Первое правило. Второе правило."
        # Смещения — от старой версии страницы (до вставки): хвост обрезается.
        r = resolve_reanchor(html, quote, "", "", 1, 1, 0, len(quote))
        self.assertIsNotNone(r)
        self.assertEqual(
            r["text_content"], "Первое правило. Вставка автора. Второе правило."
        )
        self.assertEqual(r["anchor_block_start"], 1)

    def test_quote_spanning_blocks_is_found(self):
        html = "<p>Один два</p><p>три четыре</p>"
        # selection.toString() дал перенос на границе блоков.
        r = resolve_reanchor(html, "два\nтри", "", "", None, None, 0, 0)
        self.assertIsNotNone(r)
        self.assertEqual(r["anchor_block_start"], 0)
        self.assertEqual(r["anchor_block_end"], 1)
        self.assertEqual(r["start_char_offset"], len("Один "))
        self.assertEqual(r["end_char_offset"], len("три"))


class ResolveReanchorPartial(unittest.TestCase):
    """Частичное совпадение (v1.5.8): цитату правили — реанкор сжимает её до
    уцелевшего текста в якорном блоке, как Confluence сжимает inline-комментарий
    до оставшегося текста."""

    QUOTE = "Текст под подзаголовок четвертого уровня."

    def test_deleted_word_shrinks_quote_to_surviving_text(self):
        html = "<p>Шапка</p><p>Текст под четвертого уровня.</p>"
        r = resolve_reanchor(html, self.QUOTE, "", "", 1, 1, 0, len(self.QUOTE))
        self.assertIsNotNone(r)
        self.assertEqual(r["text_content"], "Текст под четвертого уровня.")
        self.assertEqual(r["anchor_block_start"], 1)
        self.assertEqual(r["anchor_block_end"], 1)

    def test_rewritten_block_still_returns_none(self):
        # Уцелело меньше половины цитаты — не перепривязываем.
        html = "<p>Шапка</p><p>Совершенно другое содержимое раздела.</p>"
        r = resolve_reanchor(html, self.QUOTE, "", "", 1, 1, 0, len(self.QUOTE))
        self.assertIsNone(r)

    def test_partial_is_confined_to_anchor_block(self):
        # Похожий шаблонный пункт в ЧУЖОМ блоке не должен стать цитатой
        # (историческая регрессия §6 — «прыгающая» подсветка).
        html = "<p>Уровень 3.1 — пункт один.</p><p>Совсем новое содержимое.</p>"
        r = resolve_reanchor(html, "Уровень 3 — пункт два.", "", "", 1, 1, 0, 22)
        self.assertIsNone(r)


class ProjectHighlightsPartialSurvival(unittest.TestCase):
    """Проекция при refresh (v1.5.8): правка цитаты → «Требует проверки»,
    переписанный блок → «Утрачено», удалённый блок → «Утрачено» с обнулением
    якорей (иначе съехавший индекс указывал бы на соседний текст и частичная
    подсветка «прыгала» бы на чужой пункт)."""

    QUOTE = "Текст под подзаголовок четвертого уровня."
    OLD = "<p>Шапка</p><p>Текст под подзаголовок четвертого уровня.</p>"

    def _project(self, new_html):
        h = {
            "id": "h1",
            "text_content": self.QUOTE,
            "text_before": "Шапка",
            "text_after": "",
            "anchor_block_start": 1,
            "anchor_block_end": 1,
            "start_char_offset": 0,
            "end_char_offset": len(self.QUOTE),
        }
        return project_highlights([h], new_html, self.OLD)[0]

    def test_untouched_block_projects_active(self):
        proj = self._project(self.OLD)
        self.assertEqual(proj["projected_status"], "active")

    def test_deleted_word_projects_outdated(self):
        proj = self._project("<p>Шапка</p><p>Текст под четвертого уровня.</p>")
        self.assertEqual(proj["projected_status"], "outdated")

    def test_rewritten_block_projects_lost(self):
        proj = self._project(
            "<p>Шапка</p><p>Совершенно другое содержимое раздела.</p>"
        )
        self.assertEqual(proj["projected_status"], "lost")

    def test_deleted_block_projects_lost_and_clears_anchor(self):
        proj = self._project("<p>Шапка</p>")
        self.assertEqual(proj["projected_status"], "lost")
        self.assertIsNone(proj["new_anchor_block_start"])
        self.assertIsNone(proj["new_anchor_block_end"])
        self.assertIsNone(proj["new_start_char_offset"])
        self.assertIsNone(proj["new_end_char_offset"])


class ResolveReanchorRefusesToCorrupt(unittest.TestCase):
    """Главное правило: не нашли цитату — НИЧЕГО не перезаписываем."""

    def setUp(self):
        self.html = process_confluence_html(RAW_XML, "p1")

    def test_edited_quote_returns_none(self):
        r = resolve_reanchor(
            self.html, "Этого текста на странице никогда не было",
            "", "", 1, 1, 0, 40,
        )
        self.assertIsNone(r)

    def test_out_of_range_anchor_still_finds_text(self):
        quote = extract_blocks(self.html)[1]
        r = resolve_reanchor(self.html, quote, "", "", 99, 99, 0, 10)
        self.assertIsNotNone(r)
        self.assertEqual(r["text_content"], quote)
        self.assertEqual(r["anchor_block_start"], 1)

    def test_empty_quote_returns_none(self):
        r = resolve_reanchor(self.html, "   ", "", "", 1, 1, 0, 5)
        self.assertIsNone(r)


class _StubResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _StubSession:
    """Минимум AsyncSession для флоу reanchor: get() по (модель, pk),
    единственный execute() — выборка последнего снимка."""

    def __init__(self, objects, snapshot):
        self.objects = objects
        self.snapshot = snapshot

    async def get(self, model, pk, options=None):
        return self.objects.get((model, pk))

    async def execute(self, stmt):
        return _StubResult(self.snapshot)

    async def flush(self):
        pass

    async def refresh(self, obj, attrs=None):
        pass


class ReanchorEndpoint(unittest.TestCase):
    """POST /api/highlights/{id}/reanchor — провод через роутер.

    Демо-проект (без кред) — доступ проверяется по создателю, БД не нужна.
    """

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
            page_id=self.page.id, confluence_version=1, content_html=RAW_XML,
        )
        self.snapshot.id = uuid.uuid4()

        processed = process_confluence_html(RAW_XML, str(self.page.id))
        self.quote = extract_blocks(processed)[1]

        self.highlight = Highlight(
            page_id=self.page.id, snapshot_id=self.snapshot.id,
            start_xpath="", start_offset=0, end_xpath="", end_offset=0,
            text_content=self.quote, text_before="", text_after="",
            # Съехавший якорь из реального бага: конец уехал в соседний блок.
            anchor_block_start=1, anchor_block_end=2,
            start_char_offset=0, end_char_offset=22,
            status="outdated", created_by=self.user.id,
        )
        self.highlight.id = uuid.uuid4()
        self.highlight.created_at = datetime.now(timezone.utc)

        objects = {
            (User, self.user.id): self.user,
            (Page, self.page.id): self.page,
            (Project, self.project.id): self.project,
            (Highlight, self.highlight.id): self.highlight,
        }
        session = _StubSession(objects, self.snapshot)
        app.dependency_overrides[get_db] = lambda: session
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

    def test_reanchor_preserves_quote_and_heals_anchor(self):
        resp = self.client.post(f"/api/highlights/{self.highlight.id}/reanchor")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["text_content"], self.quote)
        self.assertEqual(data["status"], "active")
        self.assertEqual(data["anchor_block_start"], 1)
        self.assertEqual(data["anchor_block_end"], 1)
        self.assertEqual(data["end_char_offset"], len(self.quote))

    def test_reanchor_refuses_when_quote_missing(self):
        self.highlight.text_content = "Этого текста на странице нет"
        resp = self.client.post(f"/api/highlights/{self.highlight.id}/reanchor")
        self.assertEqual(resp.status_code, 409)
        # Привязка не тронута: цитата и статус прежние.
        self.assertEqual(self.highlight.text_content, "Этого текста на странице нет")
        self.assertEqual(self.highlight.status, "outdated")


if __name__ == "__main__":
    unittest.main()
