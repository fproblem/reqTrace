/** Тесты клиентской нормализации base URL — зеркала серверной
 * (project_access.normalize_base_url, тесты в backend/tests/test_projects.py).
 * От согласованности зависит выбор проекта при добавлении страницы и защита
 * от проектов-двойников: расхождение с сервером = ложные подсказки в формах.
 */
import { normalizeBaseUrl, urlBelongsToBase } from './baseUrl';

describe('normalizeBaseUrl', () => {
  it('приводит схему, регистр хоста и хвостовой слэш', () => {
    expect(normalizeBaseUrl('HTTPS://Conf.Bank-X.ru/')).toBe('https://conf.bank-x.ru');
    expect(normalizeBaseUrl('conf.bank-x.ru')).toBe('https://conf.bank-x.ru');
  });

  it('сохраняет нестандартный порт и context path', () => {
    expect(normalizeBaseUrl('https://wiki.local:8443')).toBe('https://wiki.local:8443');
    expect(normalizeBaseUrl('https://host/confluence/')).toBe('https://host/confluence');
  });

  it('пустой ввод и мусор → пустая строка', () => {
    expect(normalizeBaseUrl('  ')).toBe('');
    expect(normalizeBaseUrl('ht!tp://:::')).toBe('');
  });
});

describe('urlBelongsToBase', () => {
  const base = 'https://conf.bank-x.ru';

  it('сам base и его подпути принадлежат', () => {
    expect(urlBelongsToBase('https://conf.bank-x.ru', base)).toBe(true);
    expect(urlBelongsToBase(
      'https://conf.bank-x.ru/pages/viewpage.action?pageId=42', base,
    )).toBe(true);
  });

  it('похожий хост-префикс без границы пути НЕ принадлежит', () => {
    expect(urlBelongsToBase('https://conf.bank-x.ru.evil.com/pages/1', base)).toBe(false);
    expect(urlBelongsToBase('https://conf.bank-x.runet/pages/1', base)).toBe(false);
  });

  it('context path учитывается как граница', () => {
    const withPath = 'https://host/confluence';
    expect(urlBelongsToBase('https://host/confluence/pages/1', withPath)).toBe(true);
    expect(urlBelongsToBase('https://host/confluence2/pages/1', withPath)).toBe(false);
  });

  it('пустой base → false', () => {
    expect(urlBelongsToBase('https://conf.bank-x.ru/pages/1', '')).toBe(false);
  });
});
