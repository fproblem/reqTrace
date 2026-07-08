import {
  strippedText,
  strippedEquals,
  findBestMatchIndex,
  findSplitRangesIgnoringWhitespace,
  findPartialRanges,
} from './highlightMatching';

// Правило (решение по продукту, смягчено в v1.5.8): привязка размещается точным
// совпадением текста (пробелы/переносы/невидимые символы игнорируются; вставка
// строки внутрь выделения — «разрыв» — допускается), а при правке/удалении части
// цитаты — частичным совпадением В ЯКОРНОМ БЛОКЕ (findPartialRanges) со статусом
// «Требует проверки». Точные ярусы по-прежнему НЕ размещают правленый текст —
// это защита от регрессии «прыгающей» подсветки (§6 удаление пункта, §13
// удаление абзаца): частичный поиск по всей странице запрещён.

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

describe('невидимые символы (Confluence вставляет их при перенаборе текста)', () => {
  it('zero-width space и soft hyphen игнорируются наравне с пробелами', () => {
    expect(strippedEquals('под\u200Bзаголовок', 'подзаголовок')).toBe(true);
    expect(strippedText('чет\u00ADвертого\uFEFF')).toBe('четвертого');
  });

  it('РЕГРЕССИЯ: вернувшееся слово с невидимым символом внутри не «рвёт» подсветку', () => {
    // Сценарий: слово удалили (привязка ушла в «Утрачено»), затем набрали
    // заново — редактор оставил внутри zero-width space. Раньше цитата
    // считалась изменённой, и подсветка рвалась на префикс+суффикс вокруг
    // невидимого символа. Теперь — один сплошной диапазон.
    const page = 'Текст под под\u200Bзаголовок четвертого уровня.';
    const r = findSplitRangesIgnoringWhitespace(
      page, 'Текст под подзаголовок четвертого уровня.', '', '',
    );
    expect(r.length).toBe(1);
    expect(page.substring(r[0].start, r[0].end).replace(/[\s\u200B]/g, ''))
      .toBe('Текстподподзаголовокчетвертогоуровня.');
  });
});

describe('findPartialRanges: уцелевшие куски цитаты в якорном блоке (v1.5.8)', () => {
  const quote = 'Текст под подзаголовок четвертого уровня.';

  it('слово удалили из цитаты → два уцелевших куска (как inline-комментарий Confluence)', () => {
    const block = 'Текст под четвертого уровня.';
    const r = findPartialRanges(block, quote);
    expect(r.length).toBe(2);
    expect(block.substring(r[0].start, r[0].end)).toBe('Текст под');
    expect(block.substring(r[1].start, r[1].end)).toBe('четвертого уровня.');
  });

  it('слово заменили в середине → уцелели начало и конец цитаты', () => {
    const block = 'Текст под врезку четвертого уровня.';
    const r = findPartialRanges(block, quote);
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(block.substring(r[0].start, r[0].end)).toContain('Текст под');
    expect(block.substring(r[r.length - 1].start, r[r.length - 1].end))
      .toContain('четвертого уровня.');
  });

  it('блок переписан почти целиком (уцелело < половины) → пусто → «Утрачено»', () => {
    expect(findPartialRanges('Совершенно другое содержимое раздела.', quote)).toEqual([]);
  });

  it('случайные совпадения коротких буквосочетаний следом цитаты не считаются', () => {
    // Общие куски короче 4 значащих символов отбрасываются целиком.
    expect(findPartialRanges('под и над, о том и о сём.', quote)).toEqual([]);
  });

  it('пустой блок или пустая цитата → пусто', () => {
    expect(findPartialRanges('', quote)).toEqual([]);
    expect(findPartialRanges('Текст.', '   ')).toEqual([]);
  });

  it('куски идут по порядку и не пересекаются', () => {
    const r = findPartialRanges('Текст под четвертого уровня.', quote);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].start).toBeGreaterThanOrEqual(r[i - 1].end);
    }
  });
});
