import { collectRevealKeys } from './treeReveal';

const page = (id: string, cpid: string, parent: string | null = null) => ({
  id, confluence_page_id: cpid, parent_confluence_page_id: parent,
});

const tree = [
  {
    project_id: 'p1',
    no_access: false,
    spaces: [
      {
        space_key: 'SPC',
        pages: [
          page('root', '100'),
          page('mid', '110', '100'),
          page('leaf', '111', '110'),
        ],
      },
    ],
  },
];

describe('collectRevealKeys', () => {
  it('вложенная страница: проект + спейс + цепочка предков, без самой страницы', () => {
    expect(collectRevealKeys(tree, 'leaf')).toEqual([
      'project:p1', 'space:p1:SPC', 'page:110', 'page:100',
    ]);
  });

  it('корневая страница: только проект и спейс', () => {
    expect(collectRevealKeys(tree, 'root')).toEqual(['project:p1', 'space:p1:SPC']);
  });

  it('страницы нет в дереве — null (дерево ещё едет или её удалили)', () => {
    expect(collectRevealKeys(tree, 'нет')).toBeNull();
  });

  it('проект без доступа не участвует в поиске', () => {
    const locked = [{ ...tree[0], no_access: true }];
    expect(collectRevealKeys(locked, 'leaf')).toBeNull();
  });

  it('цикл в цепочке предков не зацикливает обход', () => {
    const broken = [{
      project_id: 'p1',
      no_access: false,
      spaces: [{
        space_key: 'SPC',
        pages: [
          page('a', '1', '2'),
          page('b', '2', '1'),
        ],
      }],
    }];
    expect(collectRevealKeys(broken, 'a')).toEqual([
      'project:p1', 'space:p1:SPC', 'page:2', 'page:1',
    ]);
  });
});
