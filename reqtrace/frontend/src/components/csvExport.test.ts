// Тесты чистой логики CSV-выгрузки (v1.8.2): имя файла и статусы запроса.

import { buildCoverageCsvFilename, statusesForRequest } from './csvExport';

describe('buildCoverageCsvFilename', () => {
  it('полный набор статусов — имя без суффиксов, как в v1.8.1', () => {
    expect(buildCoverageCsvFilename('Оплата', '2026-08-08', ['active', 'outdated', 'lost']))
      .toBe('reqtrace-покрытие-Оплата-2026-08-08.csv');
  });

  it('частичный набор — суффиксы в фиксированном порядке, не в порядке кликов', () => {
    expect(buildCoverageCsvFilename('Оплата', '2026-08-08', ['lost', 'outdated']))
      .toBe('reqtrace-покрытие-Оплата-2026-08-08-требует-проверки-утрачено.csv');
  });

  it('один статус — один суффикс', () => {
    expect(buildCoverageCsvFilename('Оплата', '2026-08-08', ['outdated']))
      .toBe('reqtrace-покрытие-Оплата-2026-08-08-требует-проверки.csv');
  });

  it('запрещённые в именах файлов символы уходят в дефис', () => {
    expect(buildCoverageCsvFilename('A/B: v2?', '2026-08-08', ['active', 'outdated', 'lost']))
      .toBe('reqtrace-покрытие-A-B- v2--2026-08-08.csv');
  });

  it('пустое имя проекта — запасное «project»', () => {
    expect(buildCoverageCsvFilename('', '2026-08-08', ['active', 'outdated', 'lost']))
      .toBe('reqtrace-покрытие-project-2026-08-08.csv');
  });
});

describe('statusesForRequest', () => {
  it('полный набор → undefined: «все» — это отсутствие фильтра', () => {
    expect(statusesForRequest(['lost', 'active', 'outdated'])).toBeUndefined();
  });

  it('частичный набор → выбранные в фиксированном порядке', () => {
    expect(statusesForRequest(['lost', 'active'])).toEqual(['active', 'lost']);
  });
});
