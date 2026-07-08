// Пословный дифф цитаты (v1.5.9): что изменилось в тексте под маркером
// относительно замороженной цитаты. Показывается в панели у привязок
// «Требует проверки» — человек видит правку и осознанно жмёт
// «Актуализировать» (аналог: GitLab хранит и показывает исходный контекст
// outdated-комментария).
//
// Чистая функция без DOM/React — тесты quoteDiff.test.ts.

export interface DiffPart {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

// LCS по словам (пробельная токенизация; цитаты короткие — квадратичный DP
// дешевле любых хитростей). Соседние куски одного вида склеиваются.
export function quoteDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  if (!a.length && !b.length) return [];

  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], word: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) {
      last.text += ' ' + word;
    } else {
      parts.push({ kind, text: word });
    }
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('removed', a[i]);
      i++;
    } else {
      push('added', b[j]);
      j++;
    }
  }
  while (i < a.length) push('removed', a[i++]);
  while (j < b.length) push('added', b[j++]);
  return parts;
}
