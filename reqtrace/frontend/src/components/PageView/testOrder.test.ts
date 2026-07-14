import { TestLink } from '../../types';
import { compareTestKeys, sortedTests } from './testOrder';

const link = (id: string, test_key: string): TestLink => ({
  id,
  test_key,
  created_by: 'u1',
  created_at: '2026-07-13T00:00:00Z',
});

describe('compareTestKeys', () => {
  it('сортирует номера как числа, а не посимвольно', () => {
    const keys = ['REQ-100', 'REQ-9', 'REQ-10', 'REQ-1'];
    expect(keys.sort(compareTestKeys)).toEqual(['REQ-1', 'REQ-9', 'REQ-10', 'REQ-100']);
  });

  it('разные префиксы проектов идут по алфавиту', () => {
    const keys = ['REQ-1', 'ABC-50', 'PAY-2'];
    expect(keys.sort(compareTestKeys)).toEqual(['ABC-50', 'PAY-2', 'REQ-1']);
  });

  it('регистр не влияет на порядок', () => {
    expect(compareTestKeys('req-2', 'REQ-10')).toBeLessThan(0);
  });
});

describe('sortedTests', () => {
  it('сортирует связи по ключу и не мутирует исходный массив', () => {
    const tests = [link('a', 'REQ-10'), link('b', 'REQ-2'), link('c', 'ABC-7')];
    const result = sortedTests(tests);
    expect(result.map(t => t.test_key)).toEqual(['ABC-7', 'REQ-2', 'REQ-10']);
    expect(tests.map(t => t.test_key)).toEqual(['REQ-10', 'REQ-2', 'ABC-7']);
  });
});
