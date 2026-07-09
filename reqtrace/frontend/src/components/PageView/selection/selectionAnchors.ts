// Чистая математика захвата выделения (v1.5.9): Selection/Range → блочные
// якоря привязки. Вынесена из PageDetailPage, чтобы гонять юнит-тестами на
// jsdom (selectionAnchors.test.ts) — исторически именно здесь расходились
// смещения захвата и отрисовки, и подсветка «уезжала».
//
// Координатное пространство — то же, что у рендера и бэкенда (anchoring.py):
// листовые блоки обработанного HTML, символьные смещения по textContent.
// Сопоставление цитаты с координатами затем ОДИН РАЗ верифицирует сервер при
// создании (контракт эталона: textSelection + matchIndex).

import {
  BLOCK_SELECTOR,
  ContentSegment,
  getContentSegments,
  ownTextNodes,
} from '../HighlightLayer';

export interface SelectionAnchors {
  textBefore: string;
  textAfter: string;
  anchorBlockStart: number | null;
  anchorBlockEnd: number | null;
  startCharOffset: number | null;
  endCharOffset: number | null;
}

// Смещение (node, offset) от начала root в СИМВОЛАХ textContent — тем же
// обходом, каким рендер кладёт метки (Range.cloneContents показывает ровно
// текст между началом root и точкой). Смешивание способов счёта смещений
// исторически двигало подсветку.
export function measureTextOffset(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  const len = r.cloneContents().textContent?.length ?? 0;
  r.detach();
  return len;
}

// Принадлежит ли точка выделения СОБСТВЕННОМУ тексту сегмента (текст вложенных
// блочных элементов относится к их сегментам).
function segmentContains(seg: ContentSegment, container: Node): boolean {
  if (!seg.el.contains(container)) return false;
  let p: Node | null = container;
  while (p && p !== seg.el) {
    if (p instanceof Element && p.matches(BLOCK_SELECTOR)) return false;
    p = p.parentNode;
  }
  return true;
}

// Смещение точки (container, offset) в тексте сегмента — по конкатенации его
// собственных текстовых узлов (пространство якорей = anchoring.py). Точка-
// элемент (тройной клик) разрешается сравнением позиций Range.
function segmentOffsetOf(seg: ContentSegment, container: Node, offset: number): number {
  const nodes = ownTextNodes(seg.el);
  let acc = 0;
  const point = document.createRange();
  point.setStart(container, offset);
  for (const t of nodes) {
    if (t === container) return acc + offset;
    const r = document.createRange();
    r.selectNodeContents(t);
    // Точка не позже начала узла → весь собственный текст до узла уже учтён.
    if (point.compareBoundaryPoints(Range.START_TO_START, r) <= 0) return acc;
    acc += (t.textContent || '').length;
  }
  return acc;
}

/** Захват якорей выделения. null — границы выделения вне контейнера контента
 * (например, зацепили заголовок страницы или секцию «Утраченные»).
 *
 * Якорные поля могут быть null и при валидном выделении: границы не попали в
 * собственный текст ни одного сегмента (например, текст прямо в <blockquote>
 * без <p> — такого текста нет и в серверной модели). Такому выделению в модели
 * «маркер в снимке» жить негде — вызывающий код не предлагает создать привязку. */
export function captureSelectionAnchors(
  container: HTMLElement,
  range: Range,
  rawText: string,
): SelectionAnchors | null {
  // Обе границы должны лежать ВНУТРИ контейнера: measureTextOffset
  // (Range.setEnd) на чужом узле бросил бы InvalidNodeTypeError.
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const text = rawText.trim();
  const leadingTrimmed = rawText.length - rawText.trimStart().length;
  const trailingTrimmed = rawText.length - rawText.trimEnd().length;

  const fullText = container.textContent || '';
  const offsetInContainer =
    measureTextOffset(container, range.startContainer, range.startOffset) + leadingTrimmed;

  const textBefore = fullText.substring(Math.max(0, offsetInContainer - 100), offsetInContainer);
  const textAfter = fullText.substring(
    offsetInContainer + text.length,
    offsetInContainer + text.length + 100,
  );

  const segments = getContentSegments(container);
  let anchorBlockStart = -1;
  let anchorBlockEnd = -1;
  let startCharOffset = 0;
  let endCharOffset = 0;

  for (let i = 0; i < segments.length; i++) {
    if (anchorBlockStart === -1 && segmentContains(segments[i], range.startContainer)) {
      anchorBlockStart = i;
      startCharOffset =
        segmentOffsetOf(segments[i], range.startContainer, range.startOffset) + leadingTrimmed;
    }
    if (segmentContains(segments[i], range.endContainer)) {
      anchorBlockEnd = i;
      const rawEndOffset =
        segmentOffsetOf(segments[i], range.endContainer, range.endOffset) - trailingTrimmed;
      endCharOffset = Math.max(0, rawEndOffset);
      break;
    }
  }

  const blockAnchored = anchorBlockStart !== -1 && anchorBlockEnd !== -1;
  return {
    textBefore,
    textAfter,
    anchorBlockStart: blockAnchored ? anchorBlockStart : null,
    anchorBlockEnd: blockAnchored ? anchorBlockEnd : null,
    startCharOffset: blockAnchored ? startCharOffset : null,
    endCharOffset: blockAnchored ? endCharOffset : null,
  };
}
