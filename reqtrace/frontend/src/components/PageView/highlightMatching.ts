// Чистая логика сопоставления текста привязки с содержимым страницы — без DOM и
// React, чтобы её можно было покрыть юнит-тестами (highlightMatching.test.ts).
//
// Правило размещения (решение по продукту): привязка показывается ТОЛЬКО если её
// точный текст всё ещё на странице. Различия в пробелах/переносах правкой не
// считаются; вставка текста ВНУТРЬ выделения («разрыв») допускается. Любая
// правка/удаление символов выделенного текста → привязка не размещается, и далее
// получает статус «Утрачено». Никаких «процентов похожести».

export interface TextRange {
  start: number;
  end: number;
}

// Удаляет все пробельные символы и строит карту map: map[i] = индекс в исходной
// строке для i-го непробельного символа.
export function stripWhitespaceWithMap(s: string): { stripped: string; map: number[] } {
  let stripped = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (!/\s/.test(s[i])) {
      stripped += s[i];
      map.push(i);
    }
  }
  return { stripped, map };
}

// Текст без пробелов/переносов — для сравнения «по сути», игнорируя различия в
// вёрстке (selection.toString() вставляет \n на границах блоков, а textContent
// может их не иметь). Это НЕ нечёткое сравнение: символы должны совпасть все.
export function strippedText(s: string): string {
  return stripWhitespaceWithMap(s).stripped;
}

// Точное равенство двух текстов без учёта пробелов/переносов. Используется
// блочным якорем: текст под якорем должен быть РОВНО сохранённым.
export function strippedEquals(a: string, b: string): boolean {
  return strippedText(a) === strippedText(b);
}

// Размещает needle в fullText, игнорируя различия в пробелах/переносах и допуская
// РОВНО ОДНУ вставку текста внутрь выделения («разрыв», как в Confluence —
// например, добавили строку в середину). Возвращает «сырые» диапазоны
// [start, end) в исходном fullText.
//
// Важно: мы НЕ собираем needle из разрозненных символов по всей странице. Жадная
// «по-символьная» раскладка давала ложные размещения: для удалённого
// «Уровень 3 — пункт два.» все символы находились вразброс (в «Уровень 3.1 …
// пункт один.» + случайные «д», «в», «.»), и подсветка переезжала на соседа.
// Поэтому допускаем только два сценария:
//   1) текст идёт ПОДРЯД (не менялся / другая вёрстка / переехал) → один диапазон;
//   2) текст распадается на ПРЕФИКС + СУФФИКС, каждый идёт подряд, между ними —
//      одна вставка → два диапазона.
// Иначе (правка/удаление символов, несколько разных вставок) → пустой массив,
// и привязка уходит в «Утрачено».
export function findSplitRangesIgnoringWhitespace(
  fullText: string,
  needle: string,
  textBefore: string,
  _textAfter: string,
): TextRange[] {
  const { stripped: haystack, map } = stripWhitespaceWithMap(fullText);
  const sNeedle = stripWhitespaceWithMap(needle).stripped;
  if (!sNeedle) return [];

  // Якорь начала: непробельный текст прямо перед выделением (если найден) —
  // чтобы не зацепиться за такой же фрагмент в другом месте страницы.
  let anchorFrom = 0;
  const sBefore = stripWhitespaceWithMap(textBefore).stripped;
  if (sBefore) {
    const bi = haystack.indexOf(sBefore);
    if (bi !== -1) anchorFrom = bi + sBefore.length;
  }

  const toRaw = (s: number, e: number): TextRange => ({ start: map[s], end: map[e - 1] + 1 });

  // 1) Текст идёт подряд — один диапазон.
  let at = haystack.indexOf(sNeedle, anchorFrom);
  if (at === -1 && anchorFrom !== 0) at = haystack.indexOf(sNeedle, 0);
  if (at !== -1) return [toRaw(at, at + sNeedle.length)];

  // 2) «Разрыв»: префикс + суффикс, между ними одна вставка. Берём самый длинный
  //    префикс, у которого суффикс находится дальше по тексту.
  const trySplit = (from: number): TextRange[] | null => {
    for (let k = sNeedle.length - 1; k >= 1; k--) {
      const a = haystack.indexOf(sNeedle.substring(0, k), from);
      if (a === -1) continue;
      const b = haystack.indexOf(sNeedle.substring(k), a + k);
      if (b === -1) continue;
      return [toRaw(a, a + k), toRaw(b, b + (sNeedle.length - k))];
    }
    return null;
  };
  return trySplit(anchorFrom) || (anchorFrom !== 0 ? trySplit(0) : null) || [];
}

// Находит индекс точного (посимвольного) вхождения textContent в fullText.
// При нескольких вхождениях выбирает то, у которого максимально совпадает
// окружение (text_before/text_after) — это снимает неоднозначность для
// повторяющегося текста. -1 — точного вхождения нет.
export function findBestMatchIndex(
  fullText: string,
  textContent: string,
  textBefore: string,
  textAfter: string,
): number {
  const indices: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = fullText.indexOf(textContent, searchFrom);
    if (idx === -1) break;
    indices.push(idx);
    searchFrom = idx + 1;
  }

  if (indices.length === 0) return -1;
  if (indices.length === 1) return indices[0];

  let bestIdx = indices[0];
  let bestScore = -1;

  for (const idx of indices) {
    let score = 0;
    if (textBefore) {
      const actualBefore = fullText.substring(Math.max(0, idx - textBefore.length), idx);
      const minLen = Math.min(actualBefore.length, textBefore.length);
      for (let i = 1; i <= minLen; i++) {
        if (actualBefore[actualBefore.length - i] === textBefore[textBefore.length - i]) {
          score++;
        } else {
          break;
        }
      }
    }
    if (textAfter) {
      const actualAfter = fullText.substring(
        idx + textContent.length,
        idx + textContent.length + textAfter.length,
      );
      const minLen = Math.min(actualAfter.length, textAfter.length);
      for (let i = 0; i < minLen; i++) {
        if (actualAfter[i] === textAfter[i]) {
          score++;
        } else {
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }

  return bestIdx;
}
