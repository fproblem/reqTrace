// Нормализация текста для сравнения «это тот же текст?» (v1.5.9).
//
// Поисковых функций здесь больше НЕТ: в модели «маркер в снимке» фронт ничего
// не ищет — координаты привязок поддерживает сервер (services/anchoring.py),
// а слой лишь сверяет текст под координатами с текстом маркера (валидационный
// гард в HighlightLayer). Зеркало серверного norm_key: пробельные и невидимые
// символы (zero-width space и т.п. — редактор Confluence вставляет их при
// перенаборе) при сравнении не существуют.

// Пробельные И невидимые символы (zero-width space, soft hyphen, BOM).
const IGNORED_CHAR = /[\s\u200B\u200C\u200D\uFEFF\u00AD]/;

// Удаляет все пробельные/невидимые символы и строит карту map: map[i] = индекс
// в исходной строке для i-го значащего символа.
export function stripWhitespaceWithMap(s: string): { stripped: string; map: number[] } {
  let stripped = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (!IGNORED_CHAR.test(s[i])) {
      stripped += s[i];
      map.push(i);
    }
  }
  return { stripped, map };
}

// Текст без пробелов/переносов — для сравнения «по сути», игнорируя различия в
// вёрстке (selection.toString() вставляет \n на границах блоков, а textContent
// может их не иметь). Это НЕ нечёткое сравнение: значащие символы должны
// совпасть все.
export function strippedText(s: string): string {
  return stripWhitespaceWithMap(s).stripped;
}

// Точное равенство двух текстов без учёта пробелов/переносов/невидимых символов.
export function strippedEquals(a: string, b: string): boolean {
  return strippedText(a) === strippedText(b);
}
