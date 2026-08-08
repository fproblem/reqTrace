// Раскрытие дерева на странице (v1.8.1): переход из глобального поиска (и
// недавних на «/») должен ПОКАЗАТЬ страницу в дереве — вычисляем ключи
// expandState, раскрывающие путь к ней. Чистая функция — рендер и события
// живут в PageTree.

import { ProjectTree, SpaceTree, TreeNodeItem } from '../../types';

// Подмножество дерева, которое реально читает вычисление, — производное от
// настоящих типов (Pick), как у collectQueuePages: переименование поля
// сломает компиляцию здесь, а не молча.
type RevealTreeProject = Pick<ProjectTree, 'project_id' | 'no_access'> & {
  spaces: (Pick<SpaceTree, 'space_key'> & {
    pages: Pick<TreeNodeItem, 'id' | 'confluence_page_id' | 'parent_confluence_page_id'>[];
  })[];
};

/** Ключи expandState, раскрывающие путь к странице: проект, спейс и цепочка
 * предков. Сама страница НЕ раскрывается — цель увидеть её строку, а не
 * вывалить детей. null — страницы в дереве нет (ещё едет или удалена);
 * битая цепочка предков (цикл в parent_*) не зацикливает обход. */
export function collectRevealKeys(
  projects: RevealTreeProject[],
  pageId: string,
): string[] | null {
  for (const project of projects) {
    if (project.no_access) continue;
    for (const space of project.spaces) {
      const target = space.pages.find(p => p.id === pageId);
      if (!target) continue;
      const keys = [
        `project:${project.project_id}`,
        `space:${project.project_id}:${space.space_key}`,
      ];
      const byCpid = new Map(space.pages.map(p => [p.confluence_page_id, p]));
      const visited = new Set<string>();
      let cur = target.parent_confluence_page_id
        ? byCpid.get(target.parent_confluence_page_id)
        : undefined;
      while (cur && !visited.has(cur.confluence_page_id)) {
        visited.add(cur.confluence_page_id);
        keys.push(`page:${cur.confluence_page_id}`);
        cur = cur.parent_confluence_page_id
          ? byCpid.get(cur.parent_confluence_page_id)
          : undefined;
      }
      return keys;
    }
  }
  return null;
}
