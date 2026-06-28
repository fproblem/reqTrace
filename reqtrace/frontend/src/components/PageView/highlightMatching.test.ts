import {
  strippedText,
  strippedEquals,
  findBestMatchIndex,
  findSplitRangesIgnoringWhitespace,
} from './highlightMatching';

// Правило (решение по продукту): привязка размещается ТОЛЬКО при точном
// совпадении текста (пробелы/переносы игнорируются; вставка строки внутрь
// выделения — «разрыв» — допускается). Правка/удаление символов → не размещается
// → далее статус «Утрачено». Эти тесты фиксируют это правило и защищают от
// регрессии багов с «прыгающей» подсветкой (§6 удаление пункта, §13 удаление абзаца).

describe('strippedText / strippedEquals', () => {
  it('убирает все пробелы и переносы', () => {
    expect(strippedText('  a\n b\tc ')).toBe('abc');
  });

  it('равенство игнорирует различия в вёрстке, но не в символах', () => {
    expect(strippedEquals('Текст для удаления', 'Текст  для\nудаления')).toBe(true);
    expect(strippedEquals('Текст для удаления', 'Текст для удаленияX')).toBe(false);
    expect(strippedEquals('Уровень 3 — пункт два.', 'Уровень 3.1 — пункт один.')).toBe(false);
  });
});

describe('блочный якорь: точная сверка текста под якорем', () => {
  const saved = 'Текст для удаления';
  it('блок не менялся → принять', () => {
    expect(strippedEquals('Текст для удаления', saved)).toBe(true);
  });
  it('изменилась только вёрстка → принять', () => {
    expect(strippedEquals('Текст для  удаления', saved)).toBe(true);
  });
  it('блок отредактировали → отклонить', () => {
    expect(strippedEquals('Текст для удаления!', saved)).toBe(false);
  });
  it('индекс съехал на соседний пункт → отклонить', () => {
    expect(strippedEquals('Уровень 3.1 — пункт один.', saved)).toBe(false);
  });
  it('индекс съехал на чужой блок → отклонить', () => {
    expect(strippedEquals('Цитата с прямым текстом без абзаца внутри.', saved)).toBe(false);
  });
});

describe('findBestMatchIndex (точный поиск + дизамбигуация по контексту)', () => {
  it('находит единственное точное вхождение', () => {
    expect(findBestMatchIndex('… Готово …', 'Готово', '', '')).toBe(2);
  });

  it('возвращает -1, если точного текста нет', () => {
    expect(findBestMatchIndex('тут только похожий тескт', 'точный текст', '', '')).toBe(-1);
  });

  it('из нескольких одинаковых вхождений выбирает по совпадению окружения', () => {
    const full = 'A Готово X. B Готово Y.';
    const first = full.indexOf('Готово');
    const second = full.indexOf('Готово', first + 1);
    expect(findBestMatchIndex(full, 'Готово', 'B ', ' Y')).toBe(second);
    expect(findBestMatchIndex(full, 'Готово', 'A ', ' X')).toBe(first);
  });
});

describe('findSplitRangesIgnoringWhitespace (размещение «по тексту»)', () => {
  const before = 'проблемный случай выделения.';

  it('текст не менялся → один диапазон', () => {
    const full = 'хвост … Текст для удаления … ещё';
    const r = findSplitRangesIgnoringWhitespace(full, 'Текст для удаления', '', '');
    expect(r.length).toBe(1);
    expect(full.substring(r[0].start, r[0].end)).toBe('Текст для удаления');
  });

  it('различия в пробелах/переносах → всё равно размещается', () => {
    const full = '…\nТекст  для\nудаления\n…';
    expect(findSplitRangesIgnoringWhitespace(full, 'Текст для удаления', '', '').length).toBeGreaterThan(0);
  });

  it('«разрыв»: внутрь выделения вставили строку → рвётся на префикс+суффикс', () => {
    const full = 'Текст для\nНОВАЯ СТРОКА ВНУТРИ\nудаления';
    const r = findSplitRangesIgnoringWhitespace(full, 'Текст для удаления', '', '');
    expect(r.length).toBe(2); // ровно два фрагмента вокруг вставки
    expect(full.substring(r[0].start, r[0].end).replace(/\s/g, '')).toBe('Текстдля');
    expect(full.substring(r[1].start, r[1].end).replace(/\s/g, '')).toBe('удаления');
  });

  it('две отдельные вставки (3 куска) НЕ собираются → потеря (пусто)', () => {
    // 'Текст'|вставка|'для'|вставка|'удаления' — три разрозненных куска: это уже
    // не одна вставка, собирать по всей странице нельзя.
    const full = 'Текст AAA для BBB удаления';
    expect(findSplitRangesIgnoringWhitespace(full, 'Текст для удаления', '', '')).toEqual([]);
  });

  it('РЕГРЕССИЯ §13: абзац удалён, на странице только слово «Текст» → потеря (пусто)', () => {
    const page = [
      '§13 Цитата',
      'Цитата с прямым текстом без абзаца внутри. Текст лежит прямо в blockquote — потенциально проблемный случай выделения.',
      '§14. Инлайн-элементы',
    ].join('\n');
    expect(findSplitRangesIgnoringWhitespace(page, 'Текст для удаления', before, '')).toEqual([]);
  });

  it('РЕГРЕССИЯ §6: пункт удалён, рядом похожий «Уровень 3.1 …» → потеря (пусто)', () => {
    const page = [
      '1. Подкину сюда еще один пункт',
      '2. Этот пункт отправил привязку в "Утраченные"',
      '3. Уровень 3.1 — пункт один.',
      'Особое внимание: выделите именно текст родительского пункта.',
    ].join('\n');
    expect(findSplitRangesIgnoringWhitespace(page, 'Уровень 3 — пункт два.', '', '')).toEqual([]);
  });

  it('правка: пропал один символ внутри текста → потеря (пусто)', () => {
    // «удаленя» вместо «удаления» — нет ни целого вхождения, ни префикс+суффикс.
    expect(findSplitRangesIgnoringWhitespace('Текст для удаленя', 'Текст для удаления', '', '')).toEqual([]);
  });

  it('дописали символ в конце → исходный текст всё ещё идёт подряд → размещается', () => {
    // Приписка снаружи не меняет сам выделенный текст — он остаётся как подстрока.
    const r = findSplitRangesIgnoringWhitespace('Текст для удаления!', 'Текст для удаления', '', '');
    expect(r.length).toBe(1);
  });
});
