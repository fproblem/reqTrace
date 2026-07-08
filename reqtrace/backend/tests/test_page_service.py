"""Тесты записи проекции привязок в ORM-объекты (page_service.apply_projection).

Правила самой проекции проверяются в test_anchoring; здесь — что refresh-конвейер
правильно раскладывает её результат по полям привязки: новые якоря и
anchored_text у выживших, заморозка утраченных, терминальность «Утрачено».
"""
import unittest

from app.services.page_service import apply_projection

QUOTE = "Текст под подзаголовок четвертого уровня."
OLD = f"<p>Шапка</p><p>{QUOTE}</p><p>Хвост</p>"


class FakeHighlight:
    """Минимальный двойник ORM-модели: только поля, которые пишет конвейер."""

    def __init__(self, **over):
        self.id = over.get("id", "h1")
        self.status = over.get("status", "active")
        self.text_content = over.get("text_content", QUOTE)
        self.anchored_text = over.get("anchored_text")
        self.anchor_block_start = over.get("anchor_block_start", 1)
        self.anchor_block_end = over.get("anchor_block_end", 1)
        self.start_char_offset = over.get("start_char_offset", 0)
        self.end_char_offset = over.get("end_char_offset", len(QUOTE))


class ApplyProjection(unittest.TestCase):
    def test_survived_gets_new_anchors_and_anchored_text(self):
        new = OLD.replace("подзаголовок ", "")
        h = FakeHighlight(status="active")
        apply_projection([h], OLD, new)
        self.assertEqual(h.status, "outdated")
        self.assertEqual(h.anchored_text, "Текст под четвертого уровня.")
        self.assertEqual(h.anchor_block_start, 1)
        self.assertEqual(h.end_char_offset, len("Текст под четвертого уровня."))
        # Цитата заморожена — её меняет только человек.
        self.assertEqual(h.text_content, QUOTE)

    def test_unchanged_text_keeps_status_and_fills_anchored_text(self):
        h = FakeHighlight(status="active")
        apply_projection([h], OLD, OLD)
        self.assertEqual(h.status, "active")
        self.assertEqual(h.anchored_text, QUOTE)

    def test_gone_range_freezes_anchors(self):
        new = "<p>Шапка</p><p>Хвост</p>"
        h = FakeHighlight(status="active", anchored_text=QUOTE)
        apply_projection([h], OLD, new)
        self.assertEqual(h.status, "lost")
        # Якоря и последний известный текст замораживаются как были.
        self.assertEqual(h.anchor_block_start, 1)
        self.assertEqual(h.anchored_text, QUOTE)

    def test_lost_is_terminal_untouched(self):
        h = FakeHighlight(status="lost", anchor_block_start=7, anchored_text="было")
        apply_projection([h], OLD, OLD)
        self.assertEqual(h.status, "lost")
        self.assertEqual(h.anchor_block_start, 7)
        self.assertEqual(h.anchored_text, "было")

    def test_mixed_batch_processed_independently(self):
        new = OLD.replace("подзаголовок ", "").replace("Хвост", "Другой хвост")
        alive = FakeHighlight(id="alive")
        dead = FakeHighlight(id="dead", status="lost", anchor_block_start=5)
        apply_projection([alive, dead], OLD, new)
        self.assertEqual(alive.status, "outdated")
        self.assertEqual(dead.status, "lost")
        self.assertEqual(dead.anchor_block_start, 5)


if __name__ == "__main__":
    unittest.main()
