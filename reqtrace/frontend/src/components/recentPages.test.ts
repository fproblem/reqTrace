import { listRecentPages, recordRecentPage } from './recentPages';

beforeEach(() => localStorage.clear());

describe('recentPages', () => {
  it('визит поднимает страницу наверх и не плодит дублей', () => {
    recordRecentPage('a', 'А');
    recordRecentPage('b', 'Б');
    recordRecentPage('a', 'А');
    expect(listRecentPages().map(p => p.id)).toEqual(['a', 'b']);
  });

  it('повторный визит обновляет название (страницу переименовали)', () => {
    recordRecentPage('a', 'Старое');
    recordRecentPage('a', 'Новое');
    expect(listRecentPages()[0].title).toBe('Новое');
  });

  it('история ограничена десятью страницами', () => {
    for (let i = 0; i < 15; i++) recordRecentPage(`p${i}`, `Стр ${i}`);
    const list = listRecentPages();
    expect(list).toHaveLength(10);
    expect(list[0].id).toBe('p14');
  });

  it('битое содержимое хранилища — пустая история, не падение', () => {
    localStorage.setItem('reqtrace_recent_pages', '{не json');
    expect(listRecentPages()).toEqual([]);
    localStorage.setItem('reqtrace_recent_pages', JSON.stringify([{ id: 1 }, { id: 'x', title: 'ок' }]));
    expect(listRecentPages()).toEqual([{ id: 'x', title: 'ок' }]);
  });
});
