import { TestLink } from '../../types';

// Порядок тестов в списках. Сервер порядок связей не гарантирует (отдаёт как
// лежат в БД), поэтому сортирует отображение: префикс проекта по алфавиту,
// номер — как число (REQ-9 выше REQ-10, чего лексикографика не даёт).

export function compareTestKeys(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

export function sortedTests(tests: TestLink[]): TestLink[] {
  return [...tests].sort((a, b) => compareTestKeys(a.test_key, b.test_key));
}
