// Чистая математика захвата выделения (v1.5.9): Selection/Range → блочные
// якоря привязки. Вынесена из PageDetailPage, чтобы гонять юнит-тестами на
// jsdom (selectionAnchors.test.ts) — исторически именно здесь расходились
// смещения захвата и отрисовки, и подсветка «уезжала».
//
// Координатное пространство — то же, что у рендера и бэкенда (anchoring.py):
// листовые блоки обработанного HTML, символьные смещения по textContent.
// Сопоставление цитаты с координатами затем ОДИН РАЗ верифицирует сервер при
// создании (контракт эталона: textSelection + matchIndex).

import { getContentBlocks } from '../HighlightLayer';

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

/** Захват якорей выделения. null — границы выделения вне контейнера контента
 * (например, зацепили заголовок страницы или секцию «Утраченные»).
 *
 * Якорные поля могут быть null и при валидном выделении: границы не попали в
 * листовые блоки (текст прямо в <blockquote> без <p>, контейнерный <ul>).
 * Такому выделению в модели «маркер в снимке» жить негде — вызывающий код не
 * предлагает создать привязку. */
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

  const blocks = getContentBlocks(container);
  let anchorBlockStart = -1;
  let anchorBlockEnd = -1;
  let startCharOffset = 0;
  let endCharOffset = 0;

  for (let i = 0; i < blocks.length; i++) {
    if (anchorBlockStart === -1 && blocks[i].contains(range.startContainer)) {
      anchorBlockStart = i;
      startCharOffset =
        measureTextOffset(blocks[i], range.startContainer, range.startOffset) + leadingTrimmed;
    }
    if (blocks[i].contains(range.endContainer)) {
      anchorBlockEnd = i;
      const rawEndOffset =
        measureTextOffset(blocks[i], range.endContainer, range.endOffset) - trailingTrimmed;
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
