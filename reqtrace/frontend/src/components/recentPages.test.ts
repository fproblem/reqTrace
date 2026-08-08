import { listRecentEntries, recordRecentPage, recordRecentTest } from './recentPages';

beforeEach(() => localStorage.clear());

describe('recentPages', () => {
  it('визит поднимает страницу наверх и не плодит дублей', () => {
    recordRecentPage('u1', 'a', 'А');
    recordRecentPage('u1', 'b', 'Б');
    recordRecentPage('u1', 'a', 'А');
    expect(listRecentEntries('u1').map(p => p.id)).toEqual(['a', 'b']);
  });

  it('страницы и тесты живут одним хронологическим списком', () => {
    recordRecentPage('u1', 'a', 'Оплата');
    recordRecentTest('u1', 'PAY-1', 'p1', 'Оплата картой');
    recordRecentPage('u1', 'b', 'Возвраты');
    const list = listRecentEntries('u1');
    expect(list.map(e => `${e.kind}:${e.id}`)).toEqual(['page:b', 'test:PAY-1', 'page:a']);
    expect(list[1].projectId).toBe('p1');
    expect(list[1].subtitle).toBe('Оплата картой');
  });

  it('одинаковый ключ теста в разных проектах — две записи, в одном — дедуп', () => {
    recordRecentTest('u1', 'PAY-1', 'p1');
    recordRecentTest('u1', 'PAY-1', 'p2');
    recordRecentTest('u1', 'PAY-1', 'p1');
    const list = listRecentEntries('u1');
    expect(list).toHaveLength(2);
    expect(list.map(e => e.projectId)).toEqual(['p1', 'p2']);
  });

  it('история персональна: аккаунты в одном браузере не видят друг друга', () => {
    recordRecentPage('u1', 'a', 'Страница первого');
    recordRecentTest('u2', 'PAY-1', 'p1');
    expect(listRecentEntries('u1').map(p => p.id)).toEqual(['a']);
    expect(listRecentEntries('u2').map(p => p.id)).toEqual(['PAY-1']);
  });

  it('записи до появления тестов (без kind) читаются как страницы', () => {
    localStorage.setItem(
      'reqtrace_recent_pages:u1',
      JSON.stringify([{ id: 'a', title: 'Старая запись' }]),
    );
    expect(listRecentEntries('u1')).toEqual([
      { id: 'a', title: 'Старая запись', kind: 'page' },
    ]);
  });

  it('общий ключ доперсональной эпохи вычищается при первой записи', () => {
    localStorage.setItem('reqtrace_recent_pages', JSON.stringify([{ id: 'x', title: 'чужое' }]));
    recordRecentPage('u1', 'a', 'А');
    expect(localStorage.getItem('reqtrace_recent_pages')).toBeNull();
    expect(listRecentEntries('u1').map(p => p.id)).toEqual(['a']);
  });

  it('повторный визит обновляет название (страницу переименовали)', () => {
    recordRecentPage('u1', 'a', 'Старое');
    recordRecentPage('u1', 'a', 'Новое');
    expect(listRecentEntries('u1')[0].title).toBe('Новое');
  });

  it('история ограничена десятью записями (страницы и тесты вместе)', () => {
    for (let i = 0; i < 8; i++) recordRecentPage('u1', `p${i}`, `Стр ${i}`);
    for (let i = 0; i < 4; i++) recordRecentTest('u1', `T-${i}`, 'p1');
    const list = listRecentEntries('u1');
    expect(list).toHaveLength(10);
    expect(list[0].id).toBe('T-3');
  });

  it('пустой userId — тихий no-op, битое содержимое — пустая история', () => {
    recordRecentPage('', 'a', 'А');
    expect(listRecentEntries('')).toEqual([]);
    localStorage.setItem('reqtrace_recent_pages:u1', '{не json');
    expect(listRecentEntries('u1')).toEqual([]);
    localStorage.setItem('reqtrace_recent_pages:u1', JSON.stringify([{ id: 1 }, { id: 'x', title: 'ок' }]));
    expect(listRecentEntries('u1')).toEqual([{ id: 'x', title: 'ок', kind: 'page' }]);
  });
});
