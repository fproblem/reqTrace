/** Тесты РАЗМЕЩЕНИЯ подсветок (applyHighlightsToContainer) — где на странице
 * появляются <mark> и что попадает в отчёт rendered/considered.
 *
 * Дополняют highlightMatching.test.ts: там — чистое сопоставление текста,
 * здесь — полный прогон слоя по настоящему DOM (jsdom): блочный якорь,
 * текстовый фолбэк, «разрыв», идемпотентность повторного прогона и защита от
 * оторванного контейнера (регрессия v1.5.7: слой гонял привязки новой страницы
 * по снятому с экрана содержимому старой и массово «терял» их).
 */
import { Highlight } from '../../types';
import {
  applyHighlightsToContainer,
  getContentBlocks,
  highlightDomOrder,
  compareByDomThenAnchor,
} from './HighlightLayer';

let seq = 0;

function makeHighlight(overrides: Partial<Highlight>): Highlight {
  seq += 1;
  return {
    id: `hl-${seq}`,
    page_id: 'page-1',
    snapshot_id: 'snap-1',
    start_xpath: '',
    start_offset: 0,
    end_xpath: '',
    end_offset: 0,
    text_content: '',
    text_before: '',
    text_after: '',
    anchor_block_start: null,
    anchor_block_end: null,
    start_char_offset: null,
    end_char_offset: null,
    status: 'active',
    created_by: 'u1',
    created_by_name: 'QA',
    created_at: '2026-07-05T00:00:00Z',
    reanchored_by: null,
    reanchored_by_name: null,
    reanchored_at: null,
    tests: [],
    ...overrides,
  };
}

function mount(html: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

function marksOf(container: HTMLElement, id: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(`mark[data-highlight-id="${id}"]`));
}

const noop = () => {};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('applyHighlightsToContainer: блочный якорь', () => {
  it('точный якорь → одна метка ровно на выделенном тексте', () => {
    const c = mount('<p>Первый абзац.</p><p>Второе правило работы.</p>');
    const h = makeHighlight({
      text_content: 'правило',
      anchor_block_start: 1, anchor_block_end: 1,
      start_char_offset: 7, end_char_offset: 14,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report).not.toBeNull();
    expect(report!.rendered.has(h.id)).toBe(true);
    const marks = marksOf(c, h.id);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('правило');
  });

  it('якорь съехал на чужой блок → метка ставится текстовым поиском', () => {
    const c = mount('<p>Вводный текст.</p><p>Целевое правило работы.</p>');
    const h = makeHighlight({
      text_content: 'Целевое правило',
      // Якорь указывает на первый блок, где такого текста нет.
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: 15,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(true);
    expect(marksOf(c, h.id).map(m => m.textContent).join('')).toBe('Целевое правило');
  });

  it('многоблочное выделение → метки в обоих блоках', () => {
    const c = mount('<p>Один два</p><p>три четыре</p>');
    const h = makeHighlight({
      text_content: 'два\nтри',
      anchor_block_start: 0, anchor_block_end: 1,
      start_char_offset: 5, end_char_offset: 3,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(true);
    const texts = marksOf(c, h.id).map(m => m.textContent);
    expect(texts).toEqual(['два', 'три']);
  });
});

describe('applyHighlightsToContainer: отчёт и фолбэки', () => {
  it('текста нет на странице → considered без rendered, меток нет', () => {
    const c = mount('<p>Совсем другой текст.</p>');
    const h = makeHighlight({ text_content: 'Удалённое требование' });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.considered.has(h.id)).toBe(true);
    expect(report!.rendered.has(h.id)).toBe(false);
    expect(marksOf(c, h.id)).toHaveLength(0);
  });

  it('вставка внутрь выделения → подсветка «рвётся» на две метки', () => {
    const c = mount('<p>Первое правило. Вставка автора. Второе правило.</p>');
    const h = makeHighlight({ text_content: 'Первое правило. Второе правило.' });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(true);
    // Точки разреза — деталь жадного алгоритма (префикс может захватить
    // совпавшую букву вставки); фиксируем инвариант: ровно две метки, вместе
    // покрывающие в точности текст цитаты (без учёта пробелов).
    const marks = marksOf(c, h.id);
    expect(marks).toHaveLength(2);
    const strip = (s: string | null) => (s || '').replace(/\s+/g, '');
    expect(strip(marks.map(m => m.textContent).join(''))).toBe(strip(h.text_content));
  });

  it('повторный прогон идемпотентен: метки не дублируются', () => {
    const c = mount('<p>Правило работы.</p>');
    const h = makeHighlight({
      text_content: 'Правило',
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: 7,
    });
    applyHighlightsToContainer(c, [h], null, noop);
    applyHighlightsToContainer(c, [h], null, noop);
    expect(marksOf(c, h.id)).toHaveLength(1);
    // Текст страницы не искажён прогонами.
    expect(c.textContent).toBe('Правило работы.');
  });

  it('РЕГРЕССИЯ v1.5.7: оторванный контейнер → null и нетронутый DOM', () => {
    const detached = document.createElement('div');
    detached.innerHTML = '<p>Содержимое прошлой страницы.</p>';
    const h = makeHighlight({ text_content: 'привязка новой страницы' });
    expect(applyHighlightsToContainer(detached, [h], null, noop)).toBeNull();
    expect(detached.querySelectorAll('mark')).toHaveLength(0);
    expect(applyHighlightsToContainer(null, [h], null, noop)).toBeNull();
  });
});

describe('applyHighlightsToContainer: частичное размещение в якорном блоке (v1.5.8)', () => {
  const quote = 'Текст под подзаголовок четвертого уровня.';

  it('слово удалили из цитаты → уцелевшие куски подсвечены, отчёт partial', () => {
    const c = mount('<p>Шапка раздела.</p><p>Текст под четвертого уровня.</p>');
    const h = makeHighlight({
      text_content: quote,
      anchor_block_start: 1, anchor_block_end: 1,
      start_char_offset: 0, end_char_offset: quote.length,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(true);
    expect(report!.partial.has(h.id)).toBe(true);
    const texts = marksOf(c, h.id).map(m => m.textContent);
    expect(texts).toEqual(['Текст под', 'четвертого уровня.']);
  });

  it('точное совпадение остаётся точным: partial в отчёте пуст', () => {
    const c = mount(`<p>${quote}</p>`);
    const h = makeHighlight({
      text_content: quote,
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: quote.length,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(true);
    expect(report!.partial.has(h.id)).toBe(false);
  });

  it('блок переписан почти целиком → меток нет, привязка не отрисована', () => {
    const c = mount('<p>Шапка.</p><p>Совершенно другое содержимое раздела.</p>');
    const h = makeHighlight({
      text_content: quote,
      anchor_block_start: 1, anchor_block_end: 1,
      start_char_offset: 0, end_char_offset: quote.length,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(false);
    expect(report!.partial.has(h.id)).toBe(false);
    expect(marksOf(c, h.id)).toHaveLength(0);
  });

  it('ЗАЩИТА §6: похожий текст в ЧУЖОМ блоке частично не подсвечивается', () => {
    // Якорь смотрит на переписанный блок; в соседнем — похожий шаблонный пункт.
    // Частичное размещение работает строго в якорном блоке — прыжка нет.
    const c = mount('<p>Уровень 3.1 — пункт один.</p><p>Совсем новое содержимое.</p>');
    const h = makeHighlight({
      text_content: 'Уровень 3 — пункт два.',
      anchor_block_start: 1, anchor_block_end: 1,
      start_char_offset: 0, end_char_offset: 22,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(false);
    expect(marksOf(c, h.id)).toHaveLength(0);
    expect(c.querySelectorAll('mark')).toHaveLength(0);
  });

  it('привязка без якоря (legacy) частично не размещается', () => {
    // Без якорного блока «уцелевшие куски» искать негде: частичный поиск по
    // всей странице — путь к переезду подсветки на чужой текст.
    const c = mount('<p>Текст под четвертого уровня.</p>');
    const h = makeHighlight({ text_content: quote });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(false);
    expect(marksOf(c, h.id)).toHaveLength(0);
  });

  it('утраченная привязка с частичным совпадением снова отрисовывается (для возврата статуса)', () => {
    const c = mount('<p>Текст под четвертого уровня.</p>');
    const h = makeHighlight({
      text_content: quote, status: 'lost',
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: quote.length,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(true);
    expect(report!.partial.has(h.id)).toBe(true);
  });
});

describe('applyHighlightsToContainer: выбор и клик', () => {
  it('выбранная привязка получает класс --selected', () => {
    const c = mount('<p>Правило работы.</p>');
    const h = makeHighlight({ text_content: 'Правило' });
    applyHighlightsToContainer(c, [h], h.id, noop);
    expect(marksOf(c, h.id)[0].classList.contains('highlight-mark--selected')).toBe(true);
  });

  it('клик по метке вызывает onClick с привязкой', () => {
    const c = mount('<p>Правило работы.</p>');
    const h = makeHighlight({ text_content: 'Правило' });
    const clicks: Highlight[] = [];
    applyHighlightsToContainer(c, [h], null, hl => clicks.push(hl));
    marksOf(c, h.id)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks.map(x => x.id)).toEqual([h.id]);
  });
});

describe('getContentBlocks', () => {
  it('возвращает только листовые блоки', () => {
    const c = mount(
      '<p>Абзац</p>' +
      '<ul><li>Пункт <ul><li>Вложенный</li></ul></li></ul>' +
      '<table><tbody><tr><td><p>В ячейке</p></td><td>Просто ячейка</td></tr></tbody></table>',
    );
    const texts = getContentBlocks(c).map(b => (b.textContent || '').trim());
    // Внешний li и td с <p> внутри — НЕ листовые: вместо них их вложенные блоки.
    expect(texts).toEqual(['Абзац', 'Вложенный', 'В ячейке', 'Просто ячейка']);
  });
});

describe('порядок навигации по привязкам', () => {
  it('отрисованные идут по позиции в DOM, неотрисованные — после, по якорю', () => {
    const c = mount('<p>Альфа. Бета.</p>');
    const alpha = makeHighlight({ text_content: 'Альфа' });
    const beta = makeHighlight({ text_content: 'Бета' });
    const lost = makeHighlight({
      text_content: 'нет на странице', status: 'lost', anchor_block_start: 0,
    });
    const lostLater = makeHighlight({
      text_content: 'тоже нет', status: 'lost', anchor_block_start: 5,
    });
    // Отдаём слою в «перепутанном» порядке.
    applyHighlightsToContainer(c, [lostLater, beta, lost, alpha], null, noop);
    const sorted = [lostLater, beta, lost, alpha].sort(
      compareByDomThenAnchor(highlightDomOrder(c)),
    );
    expect(sorted.map(h => h.id)).toEqual([alpha.id, beta.id, lost.id, lostLater.id]);
  });
});
