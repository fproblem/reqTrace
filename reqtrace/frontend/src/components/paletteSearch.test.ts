import { GROUP_LIMITS, matchScore, PaletteEntry, searchPalette } from './paletteSearch';

const entry = (kind: PaletteEntry['kind'], title: string, subtitle?: string): PaletteEntry => ({
  kind, id: title, title, subtitle, projectId: 'p1',
});

describe('matchScore', () => {
  it('префикс сильнее префикса слова, тот — сильнее вхождения', () => {
    expect(matchScore('Оплата картой', 'опл')).toBe(0);
    expect(matchScore('Сценарии оплаты', 'опл')).toBe(1);
    expect(matchScore('Переоплата', 'опл')).toBe(2);
    expect(matchScore('Доставка', 'опл')).toBe(-1);
  });

  it('дефис — граница слова: номер в ключе TEST-123 ищется по началу', () => {
    expect(matchScore('test-123', '123')).toBe(1);
  });
});

describe('searchPalette', () => {
  it('пустой запрос — пустая выдача (палитра покажет недавние страницы)', () => {
    expect(searchPalette([entry('page', 'Оплата')], '  ')).toEqual([]);
  });

  it('группы в порядке страницы → тесты → проекты, внутри — по рангу', () => {
    const res = searchPalette([
      entry('project', 'Оплата (проект)'),
      entry('test', 'PAY-1', 'Оплата картой'),
      entry('page', 'Сценарии оплаты'),
      entry('page', 'Оплата картой'),
    ], 'оплат');
    expect(res.map(e => e.title)).toEqual([
      'Оплата картой', 'Сценарии оплаты', 'PAY-1', 'Оплата (проект)',
    ]);
  });

  it('совпадение по подзаголовку слабее совпадения по заголовку', () => {
    const res = searchPalette([
      entry('test', 'PAY-2', 'Возврат оплаты'),
      entry('test', 'ОПЛ-1'),
    ], 'опл');
    expect(res.map(e => e.title)).toEqual(['ОПЛ-1', 'PAY-2']);
  });

  it('каждая группа ограничена потолком', () => {
    const pages = Array.from({ length: GROUP_LIMITS.page + 5 }, (_, i) =>
      entry('page', `Оплата ${i}`));
    expect(searchPalette(pages, 'оплата')).toHaveLength(GROUP_LIMITS.page);
  });
});
