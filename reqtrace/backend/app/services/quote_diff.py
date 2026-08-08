"""Пословный дифф цитаты для CSV-среза покрытия (v1.8.2).

Зеркало фронтового quoteDiff.ts (дифф в панели привязки): та же пробельная
токенизация и тот же потолок размера, но результат — одна строка с
wdiff-маркерами [-удалено-] {+добавлено+}. Её читает и человек в Excel,
и парсер внешней ИИ-системы актуализации тестов, ради которой срез и
существует. Последовательность кусков может отличаться от панели
(SequenceMatcher выбирает другой из равнозначных путей сопоставления) —
оба честно показывают одни и те же изменения.
"""
from difflib import SequenceMatcher

# Потолок произведения слов(до) × слов(после) — как MAX_DIFF_CELLS в
# quoteDiff.ts: цитаты не ограничены по размеру, и на многотысячесловных
# выделениях квадратичное сопоставление непозволительно дорого.
# Выше потолка — None, ячейка диффа в CSV остаётся пустой.
MAX_DIFF_CELLS = 250_000


def quote_word_diff(before: str, after: str) -> str | None:
    """Пословный дифф «было → стало» одной строкой с маркерами.

    None — вход больше потолка (дифф не считается); пустая строка — оба
    текста пусты по словам.
    """
    a = (before or "").split()
    b = (after or "").split()
    if len(a) * len(b) > MAX_DIFF_CELLS:
        return None

    parts: list[str] = []
    # autojunk отключён: эвристика «популярных» элементов выкидывала бы из
    # сопоставления частые слова (предлоги, союзы) на длинных цитатах.
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op in ("equal", "delete", "replace") and i2 > i1:
            chunk = " ".join(a[i1:i2])
            parts.append(chunk if op == "equal" else f"[-{chunk}-]")
        if op in ("insert", "replace") and j2 > j1:
            parts.append(f"{{+{' '.join(b[j1:j2])}+}}")
    return " ".join(parts)
