// Тесты чистой логики CSV-выгрузки (v1.8.2): имя файла и статусы запроса;
// v1.8.3 — JQL-фильтр уникальных тестов выгрузки.

import {
  buildCoverageCsvFilename, buildJiraFilter, JqlSourceTest, statusesForRequest,
} from './csvExport';

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

describe('buildJiraFilter', () => {
  const t = (key: string, extra: Partial<JqlSourceTest> = {}): JqlSourceTest => ({
    key, active: 0, outdated: 0, lost: 0, ...extra,
  });

  it('в фильтре — уникальные тесты с хотя бы одной привязкой выбранного статуса', () => {
    const r = buildJiraFilter(
      [t('TEST-1', { outdated: 3 }), t('TEST-2', { active: 1 })],
      ['outdated'],
    );
    expect(r.keys).toEqual(['TEST-1']);
    expect(r.jql).toBe('key in (TEST-1)');
    expect(r.skipped).toBe(0);
  });

  it('ключи в натуральном порядке: TEST-9 раньше TEST-10', () => {
    const r = buildJiraFilter(
      [t('TEST-10', { lost: 1 }), t('TEST-9', { lost: 1 })],
      ['lost'],
    );
    expect(r.jql).toBe('key in (TEST-9, TEST-10)');
  });

  it('не по формату и not_found исключаются и честно считаются в skipped', () => {
    const r = buildJiraFilter(
      [
        t('кривой ключ', { outdated: 1 }),
        t('TEST-404', { outdated: 1, jira_status: 'not_found' }),
        t('TEST-1', { outdated: 1 }),
      ],
      ['outdated'],
    );
    expect(r.keys).toEqual(['TEST-1']);
    expect(r.skipped).toBe(2);
  });

  it('error/null от Jira НЕ исключают тест — задача, скорее всего, существует', () => {
    const r = buildJiraFilter(
      [t('TEST-1', { outdated: 1, jira_status: 'error' }), t('TEST-2', { outdated: 1 })],
      ['outdated'],
    );
    expect(r.keys).toEqual(['TEST-1', 'TEST-2']);
  });

  it('нет подходящих тестов → пустой jql', () => {
    const r = buildJiraFilter([t('TEST-1', { active: 1 })], ['lost']);
    expect(r).toEqual({ jql: '', keys: [], skipped: 0 });
  });
});
