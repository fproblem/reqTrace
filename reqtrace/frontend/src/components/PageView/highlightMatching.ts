// Чистая логика сопоставления текста привязки с содержимым страницы — без DOM и
// React, чтобы её можно было покрыть юнит-тестами (highlightMatching.test.ts).
//
// Правило размещения (решение по продукту, смягчено в v1.5.8 — ближе к
// inline-комментариям Confluence): привязка показывается точным совпадением
// (различия в пробелах/вёрстке и одна вставка ВНУТРЬ выделения правкой не
// считаются), а при правке/удалении части выделенного текста — частичным
// совпадением В ПРЕДЕЛАХ ЯКОРНОГО БЛОКА: подсвечиваются уцелевшие куски цитаты,
// и привязка получает статус «Требует проверки». «Утрачено» — только когда от
// цитаты в её блоке осталось меньше половины (PARTIAL_MIN_SURVIVAL). Поиска
// «похожего» текста по всей странице по-прежнему нет — это защита от
// исторического бага с переездом подсветки на чужой текст.

export interface TextRange {
  start: number;
  end: number;
}

// Пробельные И невидимые символы (zero-width space, soft hyphen, BOM):
// Confluence-редактор вставляет невидимые символы при перенаборе текста —
// глазом они неотличимы, поэтому для сопоставления их не существует.
// Из-за них же «вернувшийся» текст мог считаться изменённым и подсветка
// рвалась на части.
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

// --- Частичное совпадение (v1.5.8) ---------------------------------------
//
// Эмуляция поведения inline-комментариев Confluence: при правке/удалении части
// закомментированного текста комментарий остаётся на уцелевшей части. У нас
// якорь — цитата, поэтому «уцелевшую часть» ищем диффом цитаты против текста
// её ЯКОРНОГО БЛОКА (и только его — по всей странице частичный поиск запрещён,
// см. шапку файла).

/** Кусок короче этого — не «след цитаты», а случайное совпадение букв. */
const PARTIAL_MIN_RUN = 4;
/** Уцелело меньше этой доли значащих символов цитаты → «Утрачено». */
export const PARTIAL_MIN_SURVIVAL = 0.5;

// Общие куски needle и haystack в порядке следования (разложение по самой
// длинной общей подстроке, рекурсивно слева и справа от неё — как в
// diff-алгоритмах). Куски не пересекаются и не «перекрещиваются», короче
// minRun — отбрасываются вместе со своей веткой рекурсии.
function commonRuns(
  a: string,
  b: string,
  minRun: number,
): Array<{ ai: number; bi: number; len: number }> {
  if (a.length < minRun || b.length < minRun) return [];

  // Самая длинная общая подстрока: DP по строкам, память O(|b|).
  let bestLen = 0;
  let bestAi = 0;
  let bestBi = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > bestLen) {
          bestLen = cur[j];
          bestAi = i - cur[j];
          bestBi = j - cur[j];
        }
      }
    }
    prev = cur;
  }
  if (bestLen < minRun) return [];

  const left = commonRuns(a.slice(0, bestAi), b.slice(0, bestBi), minRun);
  const right = commonRuns(a.slice(bestAi + bestLen), b.slice(bestBi + bestLen), minRun)
    .map(r => ({ ai: r.ai + bestAi + bestLen, bi: r.bi + bestBi + bestLen, len: r.len }));
  return [...left, { ai: bestAi, bi: bestBi, len: bestLen }, ...right];
}

// Уцелевшие куски needle в blockText (текст якорного блока привязки).
// Возвращает «сырые» диапазоны [start, end) в blockText, если суммарно уцелело
// ≥ PARTIAL_MIN_SURVIVAL значащих символов цитаты; иначе пустой массив —
// вызывающий код отправляет привязку в «Утрачено».
export function findPartialRanges(blockText: string, needle: string): TextRange[] {
  const { stripped: haystack, map } = stripWhitespaceWithMap(blockText);
  const sNeedle = stripWhitespaceWithMap(needle).stripped;
  if (!sNeedle || !haystack) return [];

  const runs = commonRuns(sNeedle, haystack, PARTIAL_MIN_RUN);
  const survived = runs.reduce((n, r) => n + r.len, 0);
  if (survived < sNeedle.length * PARTIAL_MIN_SURVIVAL) return [];

  return runs.map(r => ({ start: map[r.bi], end: map[r.bi + r.len - 1] + 1 }));
}
