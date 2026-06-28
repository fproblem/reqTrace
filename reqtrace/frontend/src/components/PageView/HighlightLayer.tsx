import React, { useEffect, useCallback } from 'react';
import { Highlight } from '../../types';

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, td, th, pre, dt, dd';

export function getContentBlocks(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[];
  return all.filter(el => !el.querySelector(BLOCK_SELECTOR));
}

// Карта id подсветки -> порядковый номер по позиции отрисованной <mark> в DOM
// (порядок документа = визуально сверху вниз). Берётся первое вхождение каждой
// подсветки (многосегментные/многоблочные дают несколько <mark> с одним id).
export function highlightDomOrder(root: ParentNode = document): Map<string, number> {
  const order = new Map<string, number>();
  let i = 0;
  root.querySelectorAll('mark[data-highlight-id]').forEach(m => {
    const id = (m as HTMLElement).dataset.highlightId;
    if (id && !order.has(id)) order.set(id, i++);
  });
  return order;
}

// Компаратор «сверху вниз»: сначала по фактической позиции в DOM, затем — для
// неотрисованных подсветок (например утраченных) — запасной порядок по блочному
// якорю. Так legacy-привязки (anchor_block_start === null) не уезжают в конец.
export function compareByDomThenAnchor(order: Map<string, number>) {
  return (a: Highlight, b: Highlight): number => {
    const ia = order.get(a.id);
    const ib = order.get(b.id);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1; // отрисованные — выше неотрисованных
    if (ib != null) return 1;
    const aBlock = a.anchor_block_start ?? Infinity;
    const bBlock = b.anchor_block_start ?? Infinity;
    if (aBlock !== bBlock) return aBlock - bBlock;
    return (a.start_char_offset ?? 0) - (b.start_char_offset ?? 0);
  };
}

interface HighlightLayerProps {
  container: HTMLDivElement | null;
  highlights: Highlight[];
  selectedHighlightId: string | null;
  onHighlightClick: (highlight: Highlight) => void;
}

export const HighlightLayer: React.FC<HighlightLayerProps> = ({
  container,
  highlights,
  selectedHighlightId,
  onHighlightClick,
}) => {
  const applyHighlights = useCallback(() => {
    if (!container) return;

    container.querySelectorAll('.highlight-mark').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
      }
    });
    container.normalize();

    const blocks = getContentBlocks(container);

    for (const highlight of highlights) {
      if (highlight.status === 'lost') continue;

      try {
        let rendered = false;
        if (highlight.anchor_block_start != null) {
          rendered = applyBlockAnchored(container, blocks, highlight, selectedHighlightId, onHighlightClick);
        }
        // Фолбэк: блочный якорь не дал ни одной метки (номер блока уехал за
        // пределы текущей структуры либо смещения схлопнулись в пустой диапазон
        // после изменения контента) — пробуем разместить по тексту. Так метка
        // не пропадает молча. Для legacy-привязок (anchor_block_start == null)
        // это и есть основной путь.
        if (!rendered) {
          applyLegacyTextSearch(container, highlight, selectedHighlightId, onHighlightClick);
        }
      } catch (err) {
        console.warn('Failed to apply highlight:', highlight.id, err);
      }
    }
  }, [container, highlights, selectedHighlightId, onHighlightClick]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  return null;
};

// Возвращает true, если удалось отрисовать хотя бы одну метку. false означает,
// что блочный якорь не сработал (вызывающий код тогда пробует текстовый поиск).
function applyBlockAnchored(
  container: HTMLElement,
  blocks: HTMLElement[],
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
): boolean {
  const startBlockIdx = highlight.anchor_block_start!;
  const endBlockIdx = highlight.anchor_block_end ?? startBlockIdx;
  const startCharOffset = highlight.start_char_offset ?? 0;
  const endCharOffset = highlight.end_char_offset ?? 0;

  if (startBlockIdx >= blocks.length) return false;

  if (startBlockIdx === endBlockIdx) {
    const block = blocks[startBlockIdx];
    const blockText = block.textContent || '';
    const clampedStart = Math.min(startCharOffset, blockText.length);
    const clampedEnd = Math.min(endCharOffset, blockText.length);
    if (clampedStart >= clampedEnd) return false;

    return wrapTextNodesInRange(block, clampedStart, clampedEnd, highlight, selectedId, onClick) > 0;
  } else {
    const clampedEndBlockIdx = Math.min(endBlockIdx, blocks.length - 1);
    let wrapped = 0;

    for (let bi = startBlockIdx; bi <= clampedEndBlockIdx; bi++) {
      const block = blocks[bi];
      const blockText = block.textContent || '';
      let bStart: number;
      let bEnd: number;

      if (bi === startBlockIdx) {
        bStart = Math.min(startCharOffset, blockText.length);
        bEnd = blockText.length;
      } else if (bi === clampedEndBlockIdx) {
        bStart = 0;
        bEnd = Math.min(endCharOffset, blockText.length);
      } else {
        bStart = 0;
        bEnd = blockText.length;
      }

      if (bStart >= bEnd) continue;

      wrapped += wrapTextNodesInRange(block, bStart, bEnd, highlight, selectedId, onClick);
    }
    return wrapped > 0;
  }
}

function applyLegacyTextSearch(
  container: HTMLElement,
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
) {
  const textContent = highlight.text_content;
  if (!textContent) return;

  const fullText = container.textContent || '';
  const idx = findBestMatchIndex(
    fullText, textContent, highlight.text_before, highlight.text_after,
  );
  if (idx !== -1) {
    wrapTextNodesInRange(container, idx, idx + textContent.length, highlight, selectedId, onClick);
    return;
  }

  // Фолбэк: text_content приходит из selection.toString(), которое для выделений
  // через границы блоков (абзацы, пункты списка, ячейки) вставляет переносы
  // строк \n, а container.textContent склеивает блоки без разделителей. Из-за
  // этого точного совпадения нет и подсветка не отрисовывалась вовсе. Ищем без
  // учёта различий в пробелах/переносах и оборачиваем найденный «сырой» диапазон.
  const span = findWsNormalizedRange(
    fullText, textContent, highlight.text_before, highlight.text_after,
  );
  if (!span) return;

  wrapTextNodesInRange(container, span.start, span.end, highlight, selectedId, onClick);
}

// Сжимает каждую последовательность пробельных символов в один пробел и строит
// карту map: map[i] = индекс в исходной строке для i-го символа нормализованной.
function normalizeWhitespace(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let inWs = false;
  for (let i = 0; i < s.length; i++) {
    const isWs = /\s/.test(s[i]);
    if (isWs) {
      if (!inWs) {
        norm += ' ';
        map.push(i);
        inWs = true;
      }
    } else {
      norm += s[i];
      map.push(i);
      inWs = false;
    }
  }
  return { norm, map };
}

// Ищет needle в fullText без учёта различий в пробелах/переносах и возвращает
// «сырой» диапазон [start, end) в исходном fullText (в единицах textContent,
// как их считает wrapTextNodesInRange). null — если совпадений нет.
function findWsNormalizedRange(
  fullText: string,
  needle: string,
  textBefore: string,
  textAfter: string,
): { start: number; end: number } | null {
  const { norm: haystack, map } = normalizeWhitespace(fullText);
  const normNeedle = normalizeWhitespace(needle).norm.trim();
  if (!normNeedle) return null;

  const matches: number[] = [];
  let from = 0;
  while (true) {
    const at = haystack.indexOf(normNeedle, from);
    if (at === -1) break;
    matches.push(at);
    from = at + 1;
  }
  if (matches.length === 0) return null;

  let best = matches[0];
  if (matches.length > 1 && (textBefore || textAfter)) {
    const normBefore = normalizeWhitespace(textBefore).norm;
    const normAfter = normalizeWhitespace(textAfter).norm;
    let bestScore = -1;
    for (const at of matches) {
      let score = 0;
      if (normBefore) {
        const actual = haystack.substring(Math.max(0, at - normBefore.length), at);
        const minLen = Math.min(actual.length, normBefore.length);
        for (let i = 1; i <= minLen; i++) {
          if (actual[actual.length - i] === normBefore[normBefore.length - i]) score++;
          else break;
        }
      }
      if (normAfter) {
        const tail = at + normNeedle.length;
        const actual = haystack.substring(tail, tail + normAfter.length);
        const minLen = Math.min(actual.length, normAfter.length);
        for (let i = 0; i < minLen; i++) {
          if (actual[i] === normAfter[i]) score++;
          else break;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = at;
      }
    }
  }

  const start = map[best];
  // Последний символ normNeedle не пробельный (мы сделали trim), поэтому его
  // «сырой» индекс +1 даёт корректную эксклюзивную правую границу.
  const end = map[best + normNeedle.length - 1] + 1;
  return { start, end };
}

function createMark(
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
): HTMLElement {
  const mark = document.createElement('mark');
  mark.className = `highlight-mark highlight-mark--${highlight.status}`;
  if (highlight.id === selectedId) {
    mark.classList.add('highlight-mark--selected');
  }
  mark.dataset.highlightId = highlight.id;
  mark.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(highlight);
  });
  return mark;
}

// Оборачивает выделенный диапазон [startOffset, endOffset) (смещения по тексту
// root) в подсветку, НЕ разрезая инлайн-элементы. Раньше для диапазона из
// нескольких узлов использовался range.extractContents() через границы тегов:
// он клонировал частично задетые <span>/<code>/<strong> на обе стороны mark,
// из-за чего бейджи и код «расползались» (один бейдж превращался в два).
// Здесь же каждый затронутый текстовый узел оборачивается отдельным <mark>
// через range.surroundContents в пределах ОДНОГО узла — структура предков не
// меняется, mark вставляется внутрь существующего элемента.
// Возвращает количество фактически обёрнутых сегментов (созданных <mark>).
function wrapTextNodesInRange(
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
): number {
  if (startOffset >= endOffset) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const segments: { node: Text; from: number; to: number }[] = [];
  let charCount = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = node as Text;
    const len = (text.textContent || '').length;
    const nodeStart = charCount;
    charCount += len;
    if (charCount <= startOffset) continue; // узел целиком до выделения
    if (nodeStart >= endOffset) break;       // узел целиком после выделения
    const from = Math.max(0, startOffset - nodeStart);
    const to = Math.min(len, endOffset - nodeStart);
    if (from < to) segments.push({ node: text, from, to });
  }

  // Сначала собираем сегменты, затем мутируем DOM: surroundContents разрезает
  // текстовый узел, но каждый сегмент относится к своему узлу, поэтому ссылки
  // остальных сегментов не инвалидируются.
  let wrapped = 0;
  for (const seg of segments) {
    const range = document.createRange();
    range.setStart(seg.node, seg.from);
    range.setEnd(seg.node, seg.to);
    try {
      range.surroundContents(createMark(highlight, selectedId, onClick));
      wrapped++;
    } catch (err) {
      console.warn('Failed to wrap highlight segment:', highlight.id, err);
    }
  }
  return wrapped;
}

function findBestMatchIndex(
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

export default HighlightLayer;
