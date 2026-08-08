"""Тесты пословного диффа цитаты для CSV-среза (services/quote_diff, v1.8.2).

Формат — wdiff-маркеры [-удалено-] {+добавлено+}: его читает человек в Excel
и парсит внешняя ИИ-система актуализации тестов.
"""
import unittest

from app.services.quote_diff import MAX_DIFF_CELLS, quote_word_diff


class TestQuoteWordDiff(unittest.TestCase):
    def test_replace_marks_removed_and_added(self):
        self.assertEqual(
            quote_word_diff("кнопка активна всегда", "кнопка активна после выбора"),
            "кнопка активна [-всегда-] {+после выбора+}",
        )

    def test_pure_insert_and_delete(self):
        self.assertEqual(
            quote_word_diff("оплата картой", "оплата картой и наличными"),
            "оплата картой {+и наличными+}",
        )
        self.assertEqual(
            quote_word_diff("оплата картой и наличными", "оплата картой"),
            "оплата картой [-и наличными-]",
        )

    def test_equal_texts_have_no_markers(self):
        out = quote_word_diff("один и тот же текст", "один и тот же текст")
        self.assertEqual(out, "один и тот же текст")
        self.assertNotIn("[-", out)
        self.assertNotIn("{+", out)

    def test_whitespace_only_difference_is_no_change(self):
        """Пробельная токенизация: переносы и двойные пробелы — не слова."""
        out = quote_word_diff("текст  один", "текст\nодин")
        self.assertEqual(out, "текст один")

    def test_empty_inputs(self):
        self.assertEqual(quote_word_diff("", ""), "")
        self.assertEqual(quote_word_diff("", "новый"), "{+новый+}")
        self.assertEqual(quote_word_diff("старый", ""), "[-старый-]")

    def test_over_cap_returns_none(self):
        """Выше потолка — None (ячейка в CSV пустая), а не зависший запрос."""
        words = int(MAX_DIFF_CELLS ** 0.5) + 1
        big_a = " ".join(f"a{i}" for i in range(words))
        big_b = " ".join(f"b{i}" for i in range(words))
        self.assertIsNone(quote_word_diff(big_a, big_b))


if __name__ == "__main__":
    unittest.main()
