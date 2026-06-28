import React, { useEffect, useCallback } from 'react';
import { Highlight } from '../../types';
import { colors } from '../../styles/tokens';
import {
  strippedEquals,
  findBestMatchIndex,
  findSplitRangesIgnoringWhitespace,
} from './highlightMatching';

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
      // Пытаемся отрисовать ВСЕ привязки, в т.ч. «утраченные»: если такая снова
      // легла на страницу (текст вернулся или подсветка ложится «разрывом»),
      // вызывающий код вернёт её из «Утрачено». Иначе lost-статус был бы
      // «липким» — однажды утраченную привязку слой больше никогда не пробовал
      // бы показать.
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

    // Единая рамка вокруг выбранной привязки рисуется поверх текста отдельным
    // слоем — иначе она «рвётся» по каждому инлайн-тегу (см. drawSelectionOutline).
    drawSelectionOutline(container, selectedHighlightId);
  }, [container, highlights, selectedHighlightId, onHighlightClick, onRenderReport]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  // Рамка выбора позиционируется по client-rect'ам текста, поэтому при изменении
  // ширины контента (открытие/закрытие правой панели, ресайз окна) её нужно
  // перерисовать — текст уже переносится сам, а overlay про это не знает.
  useEffect(() => {
    if (!container || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => drawSelectionOutline(container, selectedHighlightId));
    });
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [container, selectedHighlightId]);

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

  // Сначала собираем диапазоны, которые собираемся подсветить, и их текст —
  // и только потом трогаем DOM. Это позволяет СНАЧАЛА проверить, что под якорем
  // действительно наш текст: после удаления/вставки пунктов списка индекс блока
  // мог указать на чужой блок, и подсвечивать его (как было раньше) — баг.
  const targets: { block: HTMLElement; from: number; to: number }[] = [];
  const clampedEndBlockIdx = Math.min(endBlockIdx, blocks.length - 1);

  for (let bi = startBlockIdx; bi <= clampedEndBlockIdx; bi++) {
    const block = blocks[bi];
    const blockText = block.textContent || '';
    let from: number;
    let to: number;

    if (startBlockIdx === endBlockIdx) {
      from = Math.min(startCharOffset, blockText.length);
      to = Math.min(endCharOffset, blockText.length);
    } else if (bi === startBlockIdx) {
      from = Math.min(startCharOffset, blockText.length);
      to = blockText.length;
    } else if (bi === clampedEndBlockIdx) {
      from = 0;
      to = Math.min(endCharOffset, blockText.length);
    } else {
      from = 0;
      to = blockText.length;
    }

    if (from < to) targets.push({ block, from, to });
  }

  if (targets.length === 0) return false;

  // Текст под якорем должен ТОЧНО совпадать с сохранённым (без учёта пробелов и
  // переносов). Если индекс блока «съехал» на чужой блок, либо текст
  // отредактировали — совпадения нет, и мы НЕ подсвечиваем здесь: пусть сработает
  // точный текстовый поиск, иначе привязка уйдёт в «Утрачено». Никаких
  // «процентов похожести» — правка выделенного текста = потеря привязки.
  if (highlight.text_content) {
    const anchoredText = targets
      .map(t => (t.block.textContent || '').substring(t.from, t.to))
      .join('');
    if (!strippedEquals(anchoredText, highlight.text_content)) {
      return false;
    }
  }

  let wrapped = 0;
  for (const t of targets) {
    wrapped += wrapTextNodesInRange(t.block, t.from, t.to, highlight, selectedId, onClick);
  }
  return wrapped > 0;
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

  // Фолбэк: точного совпадения нет. text_content приходит из selection.toString(),
  // которое для выделений через границы блоков вставляет переносы строк \n,
  // а container.textContent между текстом пункта и вложенным списком может вовсе
  // не иметь пробела (<li>...:<ol>). Кроме того, в содержимое могли вставить
  // новую строку ВНУТРИ выделения (как в Confluence). Поэтому ищем, полностью
  // игнорируя пробелы, и допускаем вставки в середину: совпавшие куски
  // подсвечиваем по отдельности — подсветка «рвётся» на части, как
  // инлайн-комментарий в Confluence, вместо полной потери.
  const ranges = findSplitRangesIgnoringWhitespace(
    fullText, textContent, highlight.text_before, highlight.text_after,
  );

  let wrapped = 0;
  for (const r of ranges) {
    wrapped += wrapTextNodesInRange(container, r.start, r.end, highlight, selectedId, onClick);
  }
  return wrapped > 0;
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
  mark.dataset.status = highlight.status; // для drawSelectionOutline (цвет рамки)
  mark.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(highlight);
  });
  // Ховер — единый для всей привязки: наведение на любую её часть подсвечивает
  // ВСЕ её <mark> сразу (выделение, разбитое форматированием, иначе мерцало бы
  // по фрагментам). Класс снимается/ставится на всех метках с тем же id.
  const toggleHover = (on: boolean) => {
    const scope = mark.closest('.confluence-content') ?? document;
    scope
      .querySelectorAll(`mark[data-highlight-id="${cssEscapeId(highlight.id)}"]`)
      .forEach(m => m.classList.toggle('highlight-mark--hover', on));
  };
  mark.addEventListener('mouseenter', () => toggleHover(true));
  mark.addEventListener('mouseleave', () => toggleHover(false));
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

// ===========================================================================
// Единая рамка вокруг ВЫБРАННОЙ привязки
// ===========================================================================
// Раньше выбранная привязка обводилась через CSS `outline` на каждом <mark>.
// Поскольку выделение, пересекающее форматирование (полужирный/курсив/код/
// индексы), разбивается на несколько <mark> в разных родителях, получалось
// много отдельных рамок — выделение смотрелось «рвано».
//
// Здесь рамка рисуется ОДНИМ слоем поверх текста: берём диапазон выбранной
// привязки, спрашиваем у браузера его прямоугольники построчно
// (Range.getClientRects — они уже объединены через границы тегов), сливаем их в
// строчные полосы и обводим единым скруглённым контуром (SVG-path). Так на
// одной строке выходит одна рамка, а на нескольких — единый контур без
// внутренних швов, как инлайн-комментарий в Confluence.

const OUTLINE_OVERLAY_CLASS = 'highlight-selection-outline';
// Цвет рамки совпадает со статусом привязки (а заливка <mark> — его светлая
// версия): зелёный для актуальных, жёлтый для требующих актуализации, красный
// для утраченных. Так рамка «подходит» к цвету выделения.
const OUTLINE_COLOR_BY_STATUS: Record<Highlight['status'], string> = {
  active: colors.statusActive,
  outdated: colors.statusOutdated,
  lost: colors.statusLost,
};
const OUTLINE_WIDTH = 2;
const OUTLINE_OPACITY = 0.8;
const OUTLINE_RADIUS = 5;
const OUTLINE_PAD_X = 2.5; // отступ рамки от текста по горизонтали
const OUTLINE_PAD_Y = 1.5; // отступ рамки от текста по вертикали (только сверху/снизу)

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Band {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function cssEscapeId(id: string): string {
  const cssObj = (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
  return cssObj?.escape ? cssObj.escape(id) : id.replace(/["\\]/g, '\\$&');
}

function drawSelectionOutline(container: HTMLElement, selectedId: string | null): void {
  // Снести прошлую рамку (смена выбора / ресайз / перерисовка привязок).
  container.querySelectorAll(`.${OUTLINE_OVERLAY_CLASS}`).forEach(el => el.remove());
  if (!selectedId) return;

  const marks = Array.from(
    container.querySelectorAll(`mark[data-highlight-id="${cssEscapeId(selectedId)}"]`),
  ) as HTMLElement[];
  if (marks.length === 0) return; // выбранная привязка не отрисована (например, «утрачена»)

  // Цвет рамки — по статусу привязки (читаем с самой метки, чтобы не тащить
  // объект привязки через ResizeObserver).
  const status = (marks[0].dataset.status || 'active') as Highlight['status'];
  const strokeColor = OUTLINE_COLOR_BY_STATUS[status] || colors.statusActive;

  // overlay позиционируется абсолютно — контейнер должен быть точкой отсчёта.
  if (window.getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  const containerRect = container.getBoundingClientRect();

  // Привязка может быть «разорвана» вставленным текстом (несколько несмежных
  // групп <mark>) — каждую группу обводим своим контуром.
  const runs = groupContiguousMarks(marks);

  const paths: string[] = [];
  for (const run of runs) {
    const range = document.createRange();
    range.setStartBefore(run[0]);
    range.setEndAfter(run[run.length - 1]);
    const bands = buildLineBands(Array.from(range.getClientRects()), containerRect);
    if (bands.length > 0) paths.push(buildRoundedRectilinearPath(bands));
  }
  if (paths.length === 0) return;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', OUTLINE_OVERLAY_CLASS);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = `${container.scrollWidth}px`;
  svg.style.height = `${container.scrollHeight}px`;
  svg.style.overflow = 'visible';
  svg.style.pointerEvents = 'none';

  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', String(OUTLINE_WIDTH));
    path.setAttribute('stroke-opacity', String(OUTLINE_OPACITY));
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  container.appendChild(svg);
}

// Делит метки выбранной привязки на смежные группы: между двумя соседними
// <mark> допустим только пробельный «зазор» (граница тега). Непустой текст между
// ними — значит привязка «разорвана» вставкой, и группы обводятся раздельно.
function groupContiguousMarks(marks: HTMLElement[]): HTMLElement[][] {
  const runs: HTMLElement[][] = [[marks[0]]];
  for (let i = 1; i < marks.length; i++) {
    let gapText = 'x';
    try {
      const gap = document.createRange();
      gap.setStartAfter(marks[i - 1]);
      gap.setEndBefore(marks[i]);
      gapText = gap.toString();
    } catch {
      // соседние метки в разных поддеревьях — считаем разрывом
    }
    if (gapText.trim() === '') runs[runs.length - 1].push(marks[i]);
    else runs.push([marks[i]]);
  }
  return runs;
}

// Прямоугольники диапазона (по одному+ на строку) -> строчные полосы в
// координатах контейнера. Полосы стыкуются по общей границе и снабжаются
// отступами, чтобы рамка не липла к тексту.
function buildLineBands(rects: DOMRect[], containerRect: DOMRect): Band[] {
  const norm = rects
    .filter(r => r.width > 0.5 && r.height > 0.5)
    .map(r => ({
      left: r.left - containerRect.left,
      right: r.right - containerRect.left,
      top: r.top - containerRect.top,
      bottom: r.bottom - containerRect.top,
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const bands: Band[] = [];
  for (const r of norm) {
    const last = bands[bands.length - 1];
    if (last && r.top < last.bottom - 2) {
      // вертикально пересекается с текущей полосой => та же строка
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      bands.push({ ...r });
    }
  }
  if (bands.length === 0) return bands;

  // Стыкуем соседние строки по средней линии — без зазоров и нахлёстов в контуре.
  for (let i = 0; i < bands.length - 1; i++) {
    const mid = (bands[i].bottom + bands[i + 1].top) / 2;
    bands[i].bottom = mid;
    bands[i + 1].top = mid;
  }
  for (const b of bands) {
    b.left -= OUTLINE_PAD_X;
    b.right += OUTLINE_PAD_X;
  }
  bands[0].top -= OUTLINE_PAD_Y;
  bands[bands.length - 1].bottom += OUTLINE_PAD_Y;
  return bands;
}

// Строит замкнутый скруглённый контур вокруг «лесенки» строчных полос (единая
// рамка вокруг многострочного выделения, без внутренних линий между строками).
function buildRoundedRectilinearPath(bands: Band[]): string {
  const n = bands.length;
  const pts: [number, number][] = [];

  pts.push([bands[0].left, bands[0].top]);
  pts.push([bands[0].right, bands[0].top]);
  for (let i = 0; i < n; i++) {
    pts.push([bands[i].right, bands[i].bottom]);
    if (i < n - 1) pts.push([bands[i + 1].right, bands[i].bottom]); // ступенька справа
  }
  pts.push([bands[n - 1].left, bands[n - 1].bottom]);
  for (let i = n - 1; i >= 0; i--) {
    pts.push([bands[i].left, bands[i].top]);
    if (i > 0) pts.push([bands[i - 1].left, bands[i].top]); // ступенька слева
  }
  return roundedPolygonPath(dedupePoints(pts), OUTLINE_RADIUS);
}

function dedupePoints(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev[0] - p[0]) > 0.1 || Math.abs(prev[1] - p[1]) > 0.1) {
      out.push(p);
    }
  }
  // замыкание: первая и последняя точки могут совпасть
  while (
    out.length > 1 &&
    Math.abs(out[0][0] - out[out.length - 1][0]) <= 0.1 &&
    Math.abs(out[0][1] - out[out.length - 1][1]) <= 0.1
  ) {
    out.pop();
  }
  return out;
}

// Замкнутый путь по вершинам со скруглением каждого угла (радиус ужимается до
// половины смежных рёбер, чтобы короткие ступеньки не «выворачивались»).
function roundedPolygonPath(pts: [number, number][], radius: number): string {
  const n = pts.length;
  if (n < 3) {
    return n === 0 ? '' : `M ${pts.map(p => `${round(p[0])},${round(p[1])}`).join(' L ')} Z`;
  }
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const ax = p0[0] - p1[0];
    const ay = p0[1] - p1[1];
    const bx = p2[0] - p1[0];
    const by = p2[1] - p1[1];
    const lenA = Math.hypot(ax, ay);
    const lenB = Math.hypot(bx, by);
    if (lenA === 0 || lenB === 0) continue;
    const rr = Math.min(radius, lenA / 2, lenB / 2);
    const start: [number, number] = [p1[0] + (ax / lenA) * rr, p1[1] + (ay / lenA) * rr];
    const end: [number, number] = [p1[0] + (bx / lenB) * rr, p1[1] + (by / lenB) * rr];
    d += i === 0 ? `M ${round(start[0])},${round(start[1])}` : ` L ${round(start[0])},${round(start[1])}`;
    d += ` Q ${round(p1[0])},${round(p1[1])} ${round(end[0])},${round(end[1])}`;
  }
  return `${d} Z`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export default HighlightLayer;
