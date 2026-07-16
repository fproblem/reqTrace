import { NotificationEntry } from '../types';
import {
  notificationBody,
  notificationLink,
  notificationTint,
  notificationTitle,
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
    expect(notificationTitle(entry())).toBe('Ночное обновление · Платёжный шлюз');
    expect(notificationTitle(entry({ kind: 'cred_invalid' })))
      .toBe('Подключение к «Платёжный шлюз» отклонено');
    expect(notificationTitle(entry({ kind: 'run_skipped' })))
      .toBe('Обновление «Платёжный шлюз» не выполнено');
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

  it('сообщает об ошибках страниц и прерванном прогоне', () => {
    const e = entry({
      pages_changed: 2, pages_failed: 2, skipped_reason: 'no_valid_credentials',
    });
    expect(notificationBody(e)).toBe(
      'Изменились 2 страницы из 14. 2 страницы не обновились. '
      + 'Прогон прерван: закончились работающие подключения',
    );
  });
});

describe('notificationBody: креды и пропуски', () => {
  it('личная запись о кредах ведёт чинить профиль', () => {
    expect(notificationBody(entry({ kind: 'cred_invalid' }))).toBe(
      'Confluence не принял ваши логин/пароль — ночное обновление прошло без них. '
      + 'Обновите креды в профиле',
    );
  });

  it('различает недоступность и умершие подключения', () => {
    expect(notificationBody(entry({ kind: 'run_skipped', skipped_reason: 'confluence_unreachable' })))
      .toBe('Confluence был недоступен — прогон перенесён на следующую ночь');
    expect(notificationBody(entry({ kind: 'run_skipped', skipped_reason: 'no_valid_credentials' })))
      .toBe('Не осталось работающих подключений — проверьте креды в профиле');
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
