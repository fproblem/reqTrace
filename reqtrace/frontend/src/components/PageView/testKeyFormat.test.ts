import { isLikelyJiraKey } from './testKeyFormat';

describe('isLikelyJiraKey', () => {
  it.each(['PROJ-123', 'A1-9', 'ABC_QA-42', 'REQ-1'])('принимает %s', key => {
    expect(isLikelyJiraKey(key)).toBe(true);
  });

  it('регистр не считается ошибкой — Jira открывает такие ссылки', () => {
    expect(isLikelyJiraKey('proj-123')).toBe(true);
  });

  it.each([
    'ПРОЕКТ-123', // кириллица: Jira не допускает, а Р/С/А-двойники — классика опечаток
    'PROJ123',    // потерян дефис
    'PROJ-',      // нет номера
    '-123',       // нет префикса
    'PROJ 123',   // пробел вместо дефиса
    '1ABC-5',     // префикс не с буквы
    'PROJ-12A',   // номер с буквой
    '',
  ])('подсвечивает «%s»', key => {
    expect(isLikelyJiraKey(key)).toBe(false);
  });
});
