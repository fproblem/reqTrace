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

// Отчёт об отрисовке: considered — все привязки, которые слой пытался показать
// (не «утраченные»); rendered — те, у которых реально появилась хотя бы одна
// <mark>. Разница (considered − rendered) = привязки, не отобразившиеся на
// странице (например, выделенный текст не нашёлся в текущем содержимом).
export interface HighlightRenderReport {
  rendered: Set<string>;
  considered: Set<string>;
}

interface HighlightLayerProps {
  container: HTMLDivElement | null;
  highlights: Highlight[];
  selectedHighlightId: string | null;
  onHighlightClick: (highlight: Highlight) => void;
  onRenderReport?: (report: HighlightRenderReport) => void;
}

export const HighlightLayer: React.FC<HighlightLayerProps> = ({
  container,
  highlights,
  selectedHighlightId,
  onHighlightClick,
  onRenderReport,
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

    const rendered = new Set<string>();
    const considered = new Set<string>();

    for (const highlight of highlights) {
      if (highlight.status === 'lost') continue;
      considered.add(highlight.id);

      try {
        let ok = false;
        if (highlight.anchor_block_start != null) {
          ok = applyBlockAnchored(container, blocks, highlight, selectedHighlightId, onHighlightClick);
        }
        // Фолбэк: блочный якорь не дал ни одной метки (номер блока уехал за
        // пределы текущей структуры либо смещения схлопнулись в пустой диапазон
        // после изменения контента) — пробуем разместить по тексту. Так метка
        // не пропадает молча. Для legacy-привязок (anchor_block_start == null)
        // это и есть основной путь.
        if (!ok) {
          ok = applyLegacyTextSearch(container, highlight, selectedHighlightId, onHighlightClick);
        }
        if (ok) rendered.add(highlight.id);
      } catch (err) {
        console.warn('Failed to apply highlight:', highlight.id, err);
      }
    }

    onRenderReport?.({ rendered, considered });
  }, [container, highlights, selectedHighlightId, onHighlightClick, onRenderReport]);

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

// Возвращает true, если удалось отрисовать хотя бы одну метку.
function applyLegacyTextSearch(
  container: HTMLElement,
  highlight: Highlight,
  selectedId: string | null,
  onClick: (h: Highlight) => void,
): boolean {
  const textContent = highlight.text_content;
  if (!textContent) return false;

  const fullText = container.textContent || '';
  const idx = findBestMatchIndex(
    fullText, textContent, highlight.text_before, highlight.text_after,
  );
  if (idx !== -1) {
    return wrapTextNodesInRange(
      container, idx, idx + textContent.length, highlight, selectedId, onClick,
    ) > 0;
  }

  // Фолбэк: text_content приходит из selection.toString(), которое для выделений
  // через границы блоков (абзацы, пункты списка, ячейки) вставляет переносы
  // строк \n. А container.textContent между текстом пункта и вложенным списком
  // может вовсе не иметь пробела (<li>...:<ol>), поэтому даже «схлопнутые до
  // одного пробела» строки не совпадают: «один пробел против нуля». Ищем,
  // ПОЛНОСТЬЮ игнорируя пробельные символы, и оборачиваем найденный «сырой»
  // диапазон.
  const span = findRangeIgnoringWhitespace(
    fullText, textContent, highlight.text_before, highlight.text_after,
  );
  if (!span) return false;

  return wrapTextNodesInRange(
    container, span.start, span.end, highlight, selectedId, onClick,
  ) > 0;
}

// Удаляет все пробельные символы и строит карту map: map[i] = индекс в исходной
// строке для i-го непробельного символа.
function stripWhitespaceWithMap(s: string): { stripped: string; map: number[] } {
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

// Ищет needle в fullText, полностью игнорируя пробелы/переносы, и возвращает
// «сырой» диапазон [start, end) в исходном fullText (в единицах textContent,
// как их считает wrapTextNodesInRange). null — если совпадений нет.
function findRangeIgnoringWhitespace(
  fullText: string,
  needle: string,
  textBefore: string,
  textAfter: string,
): { start: number; end: number } | null {
  const { stripped: haystack, map } = stripWhitespaceWithMap(fullText);
  const strippedNeedle = stripWhitespaceWithMap(needle).stripped;
  if (!strippedNeedle) return null;

  const matches: number[] = [];
  let from = 0;
  while (true) {
    const at = haystack.indexOf(strippedNeedle, from);
    if (at === -1) break;
    matches.push(at);
    from = at + 1;
  }
  if (matches.length === 0) return null;

  let best = matches[0];
  if (matches.length > 1 && (textBefore || textAfter)) {
    const strippedBefore = stripWhitespaceWithMap(textBefore).stripped;
    const strippedAfter = stripWhitespaceWithMap(textAfter).stripped;
    let bestScore = -1;
    for (const at of matches) {
      let score = 0;
      if (strippedBefore) {
        const actual = haystack.substring(Math.max(0, at - strippedBefore.length), at);
        const minLen = Math.min(actual.length, strippedBefore.length);
        for (let i = 1; i <= minLen; i++) {
          if (actual[actual.length - i] === strippedBefore[strippedBefore.length - i]) score++;
          else break;
        }
      }
      if (strippedAfter) {
        const tail = at + strippedNeedle.length;
        const actual = haystack.substring(tail, tail + strippedAfter.length);
        const minLen = Math.min(actual.length, strippedAfter.length);
        for (let i = 0; i < minLen; i++) {
          if (actual[i] === strippedAfter[i]) score++;
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
  const end = map[best + strippedNeedle.length - 1] + 1;
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
