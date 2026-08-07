import { collectQueuePages } from './reviewQueue';

const page = (id: string, outdated: number) => ({
  id, title: `Стр ${id}`, highlights_outdated: outdated,
});

const tree = [
  {
    project_id: 'p1',
    no_access: false,
    spaces: [
      { pages: [page('a', 0), page('b', 2)] },
      { pages: [page('c', 1)] },
    ],
  },
  { project_id: 'p2', no_access: false, spaces: [{ pages: [page('d', 3)] }] },
  { project_id: 'p3', no_access: true, spaces: [{ pages: [page('e', 5)] }] },
];

describe('collectQueuePages', () => {
  it('берёт только страницы своего проекта с outdated > 0, в порядке дерева', () => {
    expect(collectQueuePages(tree, 'p1')).toEqual([
      { id: 'b', title: 'Стр b', outdated: 2 },
      { id: 'c', title: 'Стр c', outdated: 1 },
    ]);
  });

  it('проект без доступа и неизвестный проект — пустая очередь', () => {
    expect(collectQueuePages(tree, 'p3')).toEqual([]);
    expect(collectQueuePages(tree, 'нет')).toEqual([]);
  });

  it('в проекте нет «Требует проверки» — пустая очередь (start покажет тост)', () => {
    const quiet = [{ project_id: 'q', no_access: false, spaces: [{ pages: [page('x', 0)] }] }];
    expect(collectQueuePages(quiet, 'q')).toEqual([]);
  });
});
