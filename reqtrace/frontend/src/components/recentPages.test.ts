import { listRecentPages, recordRecentPage } from './recentPages';

beforeEach(() => localStorage.clear());

describe('recentPages', () => {
  it('визит поднимает страницу наверх и не плодит дублей', () => {
    recordRecentPage('u1', 'a', 'А');
    recordRecentPage('u1', 'b', 'Б');
    recordRecentPage('u1', 'a', 'А');
    expect(listRecentPages('u1').map(p => p.id)).toEqual(['a', 'b']);
  });

  it('история персональна: аккаунты в одном браузере не видят друг друга', () => {
    recordRecentPage('u1', 'a', 'Страница первого');
    recordRecentPage('u2', 'b', 'Страница второго');
    expect(listRecentPages('u1').map(p => p.id)).toEqual(['a']);
    expect(listRecentPages('u2').map(p => p.id)).toEqual(['b']);
  });

  it('общий ключ доперсональной эпохи вычищается при первой записи', () => {
    localStorage.setItem('reqtrace_recent_pages', JSON.stringify([{ id: 'x', title: 'чужое' }]));
    recordRecentPage('u1', 'a', 'А');
    expect(localStorage.getItem('reqtrace_recent_pages')).toBeNull();
    expect(listRecentPages('u1').map(p => p.id)).toEqual(['a']);
  });

  it('повторный визит обновляет название (страницу переименовали)', () => {
    recordRecentPage('u1', 'a', 'Старое');
    recordRecentPage('u1', 'a', 'Новое');
    expect(listRecentPages('u1')[0].title).toBe('Новое');
  });

  it('история ограничена десятью страницами', () => {
    for (let i = 0; i < 15; i++) recordRecentPage('u1', `p${i}`, `Стр ${i}`);
    const list = listRecentPages('u1');
    expect(list).toHaveLength(10);
    expect(list[0].id).toBe('p14');
  });

  it('пустой userId — тихий no-op, битое содержимое — пустая история', () => {
    recordRecentPage('', 'a', 'А');
    expect(listRecentPages('')).toEqual([]);
    localStorage.setItem('reqtrace_recent_pages:u1', '{не json');
    expect(listRecentPages('u1')).toEqual([]);
    localStorage.setItem('reqtrace_recent_pages:u1', JSON.stringify([{ id: 1 }, { id: 'x', title: 'ок' }]));
    expect(listRecentPages('u1')).toEqual([{ id: 'x', title: 'ок' }]);
  });
});
