/** Тесты захвата выделения (captureSelectionAnchors) — Range → блочные якоря.
 *
 * Смещения обязаны совпадать с пространством рендера (getContentBlocks +
 * textContent) и бэкенда (anchoring.doc_from_html): расхождение здесь двигало
 * подсветку. Сервер дополнительно верифицирует захват при создании привязки.
 */
import { captureSelectionAnchors, measureTextOffset } from './selectionAnchors';

function mount(html: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

// Range по вхождению needle в текстовом узле блока blockIdx контейнера.
function rangeOver(container: HTMLElement, needle: string): Range {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const i = (node.textContent || '').indexOf(needle);
    if (i !== -1) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + needle.length);
      return r;
    }
  }
  throw new Error(`needle not found: ${needle}`);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('measureTextOffset', () => {
  it('считает смещение в символах textContent от начала корня', () => {
    const c = mount('<p>Раз <b>два</b> три</p>');
    const bold = c.querySelector('b')!.firstChild as Text;
    expect(measureTextOffset(c, bold, 0)).toBe('Раз '.length);
    expect(measureTextOffset(c, bold, 3)).toBe('Раз два'.length);
  });
});

describe('captureSelectionAnchors', () => {
  it('выделение внутри одного блока → его индекс и смещения', () => {
    const c = mount('<p>Первый абзац.</p><p>Текст под подзаголовок четвертого уровня.</p>');
    const r = rangeOver(c, 'подзаголовок');
    const a = captureSelectionAnchors(c, r, 'подзаголовок')!;
    expect(a.anchorBlockStart).toBe(1);
    expect(a.anchorBlockEnd).toBe(1);
    expect(a.startCharOffset).toBe('Текст под '.length);
    expect(a.endCharOffset).toBe('Текст под подзаголовок'.length);
    expect(a.textBefore.endsWith('Текст под ')).toBe(true);
    expect(a.textAfter.startsWith(' четвертого')).toBe(true);
  });

  it('многоблочное выделение → начало и конец в своих блоках', () => {
    const c = mount('<p>Один два</p><p>три четыре</p>');
    const r = document.createRange();
    const p1 = c.querySelectorAll('p')[0].firstChild as Text;
    const p2 = c.querySelectorAll('p')[1].firstChild as Text;
    r.setStart(p1, 'Один '.length);
    r.setEnd(p2, 'три'.length);
    const a = captureSelectionAnchors(c, r, 'два\nтри')!;
    expect(a.anchorBlockStart).toBe(0);
    expect(a.anchorBlockEnd).toBe(1);
    expect(a.startCharOffset).toBe('Один '.length);
    expect(a.endCharOffset).toBe('три'.length);
  });

  it('пробельные хвосты selection.toString() срезаются из смещений', () => {
    const c = mount('<p>Раз правило работы два.</p>');
    // Браузер прихватил пробелы вокруг: сырой текст с хвостами.
    const r = rangeOver(c, ' правило работы ');
    const a = captureSelectionAnchors(c, r, ' правило работы ')!;
    expect(a.startCharOffset).toBe('Раз '.length);
    expect(a.endCharOffset).toBe('Раз правило работы'.length);
  });

  it('граница вне контейнера → null', () => {
    const c = mount('<p>Внутри.</p>');
    const outside = mount('<p>Снаружи.</p>');
    const r = document.createRange();
    r.setStart(c.querySelector('p')!.firstChild!, 0);
    r.setEnd(outside.querySelector('p')!.firstChild!, 3);
    expect(captureSelectionAnchors(c, r, 'Внутри.\nСна')).toBeNull();
  });

  it('граница вне листового блока → якорные поля null', () => {
    // Текст прямо в blockquote (без <p>) не принадлежит ни одному листовому
    // блоку — привязке в модели «маркер в снимке» жить негде.
    const c = mount('<blockquote>Цитата без абзаца внутри.</blockquote><p>Абзац.</p>');
    const r = rangeOver(c, 'Цитата');
    const a = captureSelectionAnchors(c, r, 'Цитата')!;
    expect(a.anchorBlockStart).toBeNull();
    expect(a.anchorBlockEnd).toBeNull();
    expect(a.startCharOffset).toBeNull();
    expect(a.endCharOffset).toBeNull();
  });

  it('смещения согласованы с блоками: текст под якорем == цитата', () => {
    const c = mount('<ul><li>Пункт один</li><li>Пункт два</li></ul>');
    const r = rangeOver(c, 'два');
    const a = captureSelectionAnchors(c, r, 'два')!;
    expect(a.anchorBlockStart).toBe(1);
    const blocks = c.querySelectorAll('li');
    const anchored = (blocks[1].textContent || '').substring(
      a.startCharOffset!, a.endCharOffset!,
    );
    expect(anchored).toBe('два');
  });

  it('РЕГРЕССИЯ §6: собственный текст родительского пункта — валидные якоря', () => {
    // Раньше такой текст не принадлежал ни одному листовому блоку, якоря были
    // null и кнопка «Привязать тесты» не появлялась.
    const c = mount(
      '<ul><li>Ещё один родительский пункт с двумя уровнями вложенности:' +
      '<ul><li>Уровень 2 — пункт с подпунктами:</li></ul></li></ul>',
    );
    const parent = 'Ещё один родительский пункт с двумя уровнями вложенности:';
    const r = rangeOver(c, parent);
    const a = captureSelectionAnchors(c, r, parent)!;
    expect(a.anchorBlockStart).toBe(0);
    expect(a.anchorBlockEnd).toBe(0);
    expect(a.startCharOffset).toBe(0);
    expect(a.endCharOffset).toBe(parent.length);
  });

  it('якоря вложенного пункта считаются в его сегменте, не в родителе', () => {
    const c = mount(
      '<ul><li>Родительский текст:<ul><li>Вложенный пункт А.</li></ul></li></ul>',
    );
    const r = rangeOver(c, 'пункт А');
    const a = captureSelectionAnchors(c, r, 'пункт А')!;
    expect(a.anchorBlockStart).toBe(1);
    expect(a.startCharOffset).toBe('Вложенный '.length);
    expect(a.endCharOffset).toBe('Вложенный пункт А'.length);
  });
});
