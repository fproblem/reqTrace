import { FinishedRunSummary, NotificationEntry } from '../types';
import {
  notificationBody,
  notificationLink,
  notificationTint,
  notificationTitle,
  runResultText,
} from './notificationText';

function entry(over: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: 'r1:digest',
    kind: 'digest',
    project_id: 'p1',
    project_name: 'Платёжный шлюз',
    happened_at: '2026-07-16T00:12:00Z',
    unseen: true,
    pages_total: 14,
    pages_changed: 0,
    pages_failed: 0,
    to_outdated: 0,
    to_lost: 0,
    affected_tests: [],
    skipped_reason: null,
    ...over,
  };
}

describe('notificationTitle', () => {
  it('называет вид события и проект', () => {
    expect(notificationTitle(entry())).toBe('Обновление · Платёжный шлюз');
    expect(notificationTitle(entry({ kind: 'cred_invalid' })))
      .toBe('Подключение к «Платёжный шлюз» отклонено');
    expect(notificationTitle(entry({ kind: 'run_skipped' })))
      .toBe('Обновление «Платёжный шлюз» не выполняется');
  });
});

describe('notificationBody: дайджест', () => {
  it('собирает полную сводку прогона', () => {
    const e = entry({
      pages_changed: 3, to_outdated: 4, to_lost: 1,
      affected_tests: ['PAY-101', 'PAY-104', 'PAY-9', 'REQ-2'],
    });
    expect(notificationBody(e)).toBe(
      'Изменились 3 страницы из 14. '
      + 'Привязки: 4 → «Требует проверки», 1 → «Утрачено». '
      + 'Затронуты тесты PAY-101, PAY-104 и ещё 2',
    );
  });

  it('склоняет одну страницу и не добавляет пустые части', () => {
    const e = entry({ pages_changed: 1, to_outdated: 1 });
    expect(notificationBody(e)).toBe(
      'Изменилась 1 страница из 14. Привязки: 1 → «Требует проверки»',
    );
  });

  it('перечисляет все ключи, когда их немного', () => {
    const e = entry({ to_lost: 1, affected_tests: ['REQ-1'] });
    expect(notificationBody(e)).toBe(
      'Привязки: 1 → «Утрачено». Затронуты тесты REQ-1',
    );
  });

  it('дайджест прерванного сетью прогона называет причину', () => {
    const e = entry({ to_outdated: 2, skipped_reason: 'confluence_unreachable' });
    expect(notificationBody(e)).toBe(
      'Привязки: 2 → «Требует проверки». '
      + 'Прогон прерван: Confluence стал недоступен, доберём при появлении связи',
    );
  });

  it('сообщает об ошибках страниц числом, когда названий нет (старый журнал)', () => {
    const e = entry({
      pages_changed: 2, pages_failed: 2, skipped_reason: 'no_valid_credentials',
    });
    expect(notificationBody(e)).toBe(
      'Изменились 2 страницы из 14. 2 страницы не обновились. '
      + 'Прогон прерван: закончились работающие подключения',
    );
  });

  it('называет не обновившиеся страницы поимённо, хвост — числом', () => {
    const e = entry({
      pages_failed: 3,
      failed_pages: ['Backend и API', 'iOS Jailbreak', 'Целесообразность автоматизации'],
    });
    expect(notificationBody(e)).toBe(
      'Не обновились страницы «Backend и API», «iOS Jailbreak» и ещё 1',
    );
  });

  it('одна не обновившаяся страница — по имени и со склонением', () => {
    const e = entry({ pages_failed: 1, failed_pages: ['Команда'] });
    expect(notificationBody(e)).toBe('Не обновилась страница «Команда»');
  });
});

describe('notificationBody: креды и пропуски', () => {
  it('личная запись о кредах ведёт чинить профиль', () => {
    expect(notificationBody(entry({ kind: 'cred_invalid' }))).toBe(
      'Confluence не принял ваши логин/пароль — обновление прошло без них. '
      + 'Обновите креды в профиле',
    );
  });

  it('различает недоступность и умершие подключения', () => {
    expect(notificationBody(entry({ kind: 'run_skipped', skipped_reason: 'confluence_unreachable' })))
      .toBe('Confluence недоступен — доберём, как только появится связь');
    expect(notificationBody(entry({ kind: 'run_skipped', skipped_reason: 'no_valid_credentials' })))
      .toBe('Не осталось работающих подключений — проверьте креды в профиле');
  });

  it('серия неудач показывает размах одной строкой', () => {
    const e = entry({
      kind: 'run_skipped',
      skipped_reason: 'confluence_unreachable',
      attempts: 8,
      first_attempt_at: '2026-07-16T00:12:00Z',
      happened_at: '2026-07-16T08:12:00Z',
    });
    const body = notificationBody(e);
    expect(body).toContain('Confluence недоступен — доберём, как только появится связь');
    expect(body).toContain('Попыток: 8 — первая');
    expect(body).toContain('последняя');
  });
});

describe('notificationBody: подтверждение тишины (run_quiet, v1.6.5)', () => {
  it('один тихий прогон — «изменений нет» и когда проверено', () => {
    const e = entry({ kind: 'run_quiet', id: 'r1:quiet' });
    const body = notificationBody(e);
    expect(body).toContain('Изменений нет');
    expect(body).toContain('страницы проверены');
  });

  it('серия тихих дней схлопнута в одну строку с размахом', () => {
    const e = entry({
      kind: 'run_quiet',
      attempts: 3,
      first_attempt_at: '2026-07-14T00:12:00Z',
      happened_at: '2026-07-16T00:12:00Z',
    });
    const body = notificationBody(e);
    expect(body).toContain('Спокойных прогонов: 3');
    expect(body).toContain('тишина с');
  });

  it('изменившиеся страницы без задетых привязок называются честно', () => {
    const e = entry({ kind: 'run_quiet', pages_changed: 2 });
    expect(notificationBody(e)).toContain('Страницы менялись, но привязки не задеты');
  });

  it('заголовок нейтральный, оттенок зелёный, клик ведёт на «Тесты»', () => {
    const e = entry({ kind: 'run_quiet' });
    expect(notificationTitle(e)).toBe('Обновление · Платёжный шлюз');
    expect(notificationTint(e)).toBe('green');
    expect(notificationLink(e)).toBe('/tests/p1');
  });
});

describe('notificationLink', () => {
  it('дайджест ведёт к худшему: сначала утраты, потом «требует проверки»', () => {
    expect(notificationLink(entry({ to_lost: 1, to_outdated: 3 }))).toBe('/tests/p1?f=lost');
    expect(notificationLink(entry({ to_outdated: 3 }))).toBe('/tests/p1?f=outdated');
    expect(notificationLink(entry({ pages_failed: 1 }))).toBe('/tests/p1');
  });

  it('проблемы кред и пропуски ведут в профиль', () => {
    expect(notificationLink(entry({ kind: 'cred_invalid' }))).toBe('/settings');
    expect(notificationLink(entry({ kind: 'run_skipped' }))).toBe('/settings');
  });
});

function finished(over: Partial<FinishedRunSummary> = {}): FinishedRunSummary {
  return {
    id: 'r1',
    project_id: 'p1',
    project_name: 'Платёжный шлюз',
    status: 'ok',
    finished_at: '2026-07-16T09:15:00Z',
    pages_changed: 0,
    pages_failed: 0,
    to_outdated: 0,
    to_lost: 0,
    skipped_reason: null,
    ...over,
  };
}

describe('runResultText (пилюля-индикатор)', () => {
  it('говорит итог даже там, где бейджу загораться не от чего', () => {
    expect(runResultText(finished()))
      .toEqual({ text: 'Готово — изменений нет', tone: 'quiet' });
    expect(runResultText(finished({ pages_changed: 3 })))
      .toEqual({ text: 'Готово: страницы изменились, привязки целы', tone: 'quiet' });
    expect(runResultText(finished({ status: 'skipped', skipped_reason: 'confluence_unreachable' })))
      .toEqual({ text: 'Не удалось: Confluence недоступен', tone: 'warn' });
  });

  it('находки и ошибки — коротко и с тоном', () => {
    expect(runResultText(finished({ to_outdated: 2, to_lost: 1 })))
      .toEqual({ text: 'Готово: 2 на проверку, 1 утрачена', tone: 'ok' });
    expect(runResultText(finished({ pages_failed: 2 })))
      .toEqual({ text: 'Готово, но 2 страницы не обновились', tone: 'warn' });
    expect(runResultText(finished({ status: 'skipped', skipped_reason: 'no_valid_credentials' })))
      .toEqual({ text: 'Не удалось: нет работающих подключений', tone: 'warn' });
  });
});

describe('notificationTint', () => {
  it('красный — потери, ошибки, битые креды; янтарный — проверка и пропуски', () => {
    expect(notificationTint(entry({ to_lost: 1 }))).toBe('red');
    expect(notificationTint(entry({ pages_failed: 1 }))).toBe('red');
    expect(notificationTint(entry({ kind: 'cred_invalid' }))).toBe('red');
    expect(notificationTint(entry({ to_outdated: 2 }))).toBe('amber');
    expect(notificationTint(entry({ kind: 'run_skipped' }))).toBe('amber');
    expect(notificationTint(entry({ pages_changed: 1 }))).toBe('green');
  });
});
