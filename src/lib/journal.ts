import { readingBlocks } from './reflection';

export interface SourceEntry {
  path: string;
  name: string;
  month: string;
  content: string;
}
export interface Archive {
  root: string;
  entries: SourceEntry[];
  warnings: string[];
}
export interface Entry extends SourceEntry {
  id: string;
  date: string | null;
  title: string;
  body: string;
  rating: number | null;
  weekday: string | null;
  excerpt: string;
  words: number;
  searchText: string;
}
export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function dateValue(date: string) {
  return new Date(`${date}T12:00:00`);
}
export function monthLabel(month: string) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}
export function parseEntry(source: SourceEntry): Entry {
  const stem = source.name.replace(/\.(txt|md)$/i, '');
  const match = stem.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:\.(\d+))?$/);
  let date: string | null = null;
  if (match) {
    const year =
      match[3].length === 4
        ? match[3]
        : `${source.month.slice(0, 2)}${match[3]}`;
    const candidate = `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    const parsed = dateValue(candidate);
    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getDate() === Number(match[2]) &&
      candidate.slice(0, 7) === source.month
    )
      date = candidate;
  }
  const lines = source.content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor++;
  let weekday: string | null = null,
    rating: number | null = null;
  if (
    /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)$/i.test(
      lines[cursor]?.trim() ?? '',
    )
  ) {
    weekday = lines[cursor++].trim();
    while (cursor < lines.length && !lines[cursor].trim()) cursor++;
    const score = lines[cursor]?.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*10$/);
    if (score && Number(score[1]) <= 10) {
      rating = Number(score[1]);
      cursor++;
    }
    if (/^={3,}$/.test(lines[cursor]?.trim() ?? '')) cursor++;
  } else cursor = 0;
  // Old plain-text exports indent prose with tabs; Markdown files keep their indentation.
  const body = lines
    .slice(cursor)
    .map((line) =>
      source.name.endsWith('.txt') ? line.replace(/^\t+/, '') : line,
    )
    .join('\n')
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
  const title = date
    ? dateValue(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }) + (match?.[4] ? ` · Part ${match[4]}` : '')
    : stem;
  const excerpt = readingBlocks(body)
    .map((block) =>
      block.type === 'markdown'
        ? block.text
        : block.type === 'reflection'
          ? [
              block.introduction,
              ...block.sections.flatMap((section) =>
                section.items.map((item) => item.text),
              ),
            ].join('\n')
          : '',
    )
    .join('\n')
    .replace(/[#*_>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    ...source,
    id: source.path,
    date,
    title,
    body,
    rating,
    weekday,
    excerpt,
    words,
    searchText:
      `${source.name} ${title} ${source.month} ${date ?? ''} ${body}`.toLowerCase(),
  };
}
export function sortEntries(entries: Entry[]) {
  return [...entries].sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      (a.date ?? `${a.month}-32`).localeCompare(b.date ?? `${b.month}-32`) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}
export function searchEntries(entries: Entry[], query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries
    .filter((e) => words.every((word) => e.searchText.includes(word)))
    .sort((a, b) => {
      const aName = a.name.toLowerCase().includes(query.toLowerCase());
      const bName = b.name.toLowerCase().includes(query.toLowerCase());
      return Number(bName) - Number(aName) || b.id.localeCompare(a.id);
    });
}
