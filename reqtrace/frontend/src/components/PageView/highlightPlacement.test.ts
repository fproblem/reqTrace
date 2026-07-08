/** Тесты РАЗМЕЩЕНИЯ подсветок (applyHighlightsToContainer) — v1.5.9,
 * модель «маркер в снимке»: слой рендерит привязки СТРОГО по координатам
 * (якоря поддерживает сервер при refresh), никакого поиска текста нет.
 * Валидационный гард: текст под координатами обязан совпадать с текстом
 * маркера (anchored_text, до первого refresh — цитата) — иначе метка не
 * рисуется и статусы НЕ трогаются (рассинхрон лечится обновлением).
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
    anchored_text: null,
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

describe('applyHighlightsToContainer: рендер по координатам', () => {
  it('валидный якорь → одна метка ровно на тексте маркера', () => {
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

  it('anchored_text приоритетнее цитаты: изменённый текст рендерится по якорю', () => {
    // После правки страницы refresh обновил координаты и anchored_text;
    // цитата (text_content) осталась старой — гард сверяет с anchored_text.
    const c = mount('<p>Текст под четвертого уровня.</p>');
    const h = makeHighlight({
      text_content: 'Текст под подзаголовок четвертого уровня.',
      anchored_text: 'Текст под четвертого уровня.',
      status: 'outdated',
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: 28,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.rendered.has(h.id)).toBe(true);
    expect(marksOf(c, h.id).map(m => m.textContent).join('')).toBe('Текст под четвертого уровня.');
  });
});

describe('applyHighlightsToContainer: гард и отчёт', () => {
  it('РАССИНХРОН: текст под координатами не совпал с маркером → метки нет, статус не тронут', () => {
    // Якорь указывает на чужой блок (контент и привязки от разных версий).
    const c = mount('<p>Вводный текст.</p><p>Целевое правило работы.</p>');
    const h = makeHighlight({
      text_content: 'Целевое правило',
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: 15,
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const report = applyHighlightsToContainer(c, [h], null, noop);
    warn.mockRestore();
    expect(report!.considered.has(h.id)).toBe(true);
    expect(report!.rendered.has(h.id)).toBe(false);
    expect(c.querySelectorAll('mark')).toHaveLength(0);
    expect(h.status).toBe('active'); // фронт статусы не трогает
  });

  it('привязка без якорей не рендерится (поиска по тексту нет)', () => {
    const c = mount('<p>Текст для удаления прямо здесь.</p>');
    const h = makeHighlight({ text_content: 'Текст для удаления' });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.considered.has(h.id)).toBe(true);
    expect(report!.rendered.has(h.id)).toBe(false);
    expect(marksOf(c, h.id)).toHaveLength(0);
  });

  it('«Утраченная» не рендерится и не считается, даже с валидными якорями', () => {
    // Маркер уничтожен (dangling): замороженные якоря осмыслены только для
    // прежнего снимка — рисовать по ним нельзя.
    const c = mount('<p>Правило работы.</p>');
    const h = makeHighlight({
      text_content: 'Правило', status: 'lost',
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: 7,
    });
    const report = applyHighlightsToContainer(c, [h], null, noop);
    expect(report!.considered.has(h.id)).toBe(false);
    expect(report!.rendered.has(h.id)).toBe(false);
    expect(marksOf(c, h.id)).toHaveLength(0);
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

describe('applyHighlightsToContainer: выбор и клик', () => {
  const anchored = () => makeHighlight({
    text_content: 'Правило',
    anchor_block_start: 0, anchor_block_end: 0,
    start_char_offset: 0, end_char_offset: 7,
  });

  it('выбранная привязка получает класс --selected', () => {
    const c = mount('<p>Правило работы.</p>');
    const h = anchored();
    applyHighlightsToContainer(c, [h], h.id, noop);
    expect(marksOf(c, h.id)[0].classList.contains('highlight-mark--selected')).toBe(true);
  });

  it('клик по метке вызывает onClick с привязкой', () => {
    const c = mount('<p>Правило работы.</p>');
    const h = anchored();
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
    expect(texts).toEqual(['Абзац', 'Вложенный', 'В ячейке', 'Просто ячейка']);
  });
});

describe('порядок навигации по привязкам', () => {
  it('отрисованные идут по позиции в DOM, неотрисованные — после, по якорю', () => {
    const c = mount('<p>Альфа. Бета.</p>');
    const alpha = makeHighlight({
      text_content: 'Альфа',
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 0, end_char_offset: 5,
    });
    const beta = makeHighlight({
      text_content: 'Бета',
      anchor_block_start: 0, anchor_block_end: 0,
      start_char_offset: 7, end_char_offset: 11,
    });
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
