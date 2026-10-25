/**
 * Case-insensitive normalisation for search (also treats ё as е). Done per UTF-16 unit so the
 * result keeps the original length and match positions map straight back onto the text.
 */
const normChar = (c: string) => {
  const l = c.toLocaleLowerCase();
  return l.length !== 1 ? c : l === 'ё' ? 'е' : l;
};
export const norm = (s: string) => s.split('').map(normChar).join('');

/** Positions [start, end) of every occurrence of the query in the text. */
export function matchRanges(text: string, query: string): [number, number][] {
  const q = norm(query.trim());
  if (!q) return [];
  const t = norm(text);
  const ranges: [number, number][] = [];
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) ranges.push([i, i + q.length]);
  return ranges;
}

/** True when any of the texts contains the query (an empty query matches everything). */
export function matchesAny(query: string, ...texts: (string | undefined)[]): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  return texts.some((t) => !!t && norm(t).includes(q));
}

export function byName<T extends { name: string }>(locale: string) {
  const coll = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return (a: T, b: T) => coll.compare(a.name, b.name);
}
