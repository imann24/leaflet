export const REFLECTION_SECTIONS = [
  'Gratitude',
  'Forgiveness',
  'Curiosity',
] as const;
export interface ReflectionSection {
  name: (typeof REFLECTION_SECTIONS)[number];
  items: { number: number; text: string }[];
}
export type ReadingBlock =
  | { type: 'markdown'; text: string }
  | { type: 'omitted'; raw: string }
  | {
      type: 'reflection';
      raw: string;
      introduction: string;
      sections: ReflectionSection[];
    };

const divider = (line: string) => /^\\?={3,}$/.test(line.trim());
const heading = (line: string) =>
  line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s+#+$/, '')
    .trim();
const isTitle = (line: string) => /^the\s+3\s+and\s+3$/i.test(heading(line));
const numbered = (line: string) =>
  line.replace(/\r$/, '').match(/^ {0,3}(\d+)[.)]\s+(\S.*)$/);
const blank = (line: string) => !line.trim();

function readList(lines: string[], start: number) {
  const items: ReflectionSection['items'] = [];
  let cursor = start;
  while (cursor < lines.length && blank(lines[cursor])) cursor++;
  let end = cursor;
  while (cursor < lines.length) {
    const item = numbered(lines[cursor]);
    if (!item) break;
    const text = [item[2]];
    cursor++;
    // Preserve wrapped lines and indented continuation paragraphs.
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (
        numbered(line) ||
        divider(line) ||
        REFLECTION_SECTIONS.some(
          (name) => heading(line).toLowerCase() === name.toLowerCase(),
        ) ||
        /^\s*#/.test(line)
      )
        break;
      if (blank(line)) {
        let next = cursor + 1;
        while (next < lines.length && blank(lines[next])) next++;
        if (
          next < lines.length &&
          /^\s{2,}\S/.test(lines[next]) &&
          !numbered(lines[next])
        ) {
          text.push('', lines[next].trimStart());
          cursor = next + 1;
          continue;
        }
        break;
      }
      text.push(line.trimStart());
      cursor++;
    }
    items.push({ number: Number(item[1]), text: text.join('\n') });
    end = cursor;
    while (cursor < lines.length && blank(lines[cursor])) cursor++;
  }
  return { items, next: cursor, end };
}

function exerciseStart(lines: string[], title: number) {
  let start = title;
  let before = title - 1;
  while (before >= 0 && blank(lines[before])) before--;
  let preambleStart = before;
  let hasPreamble = true;
  for (const name of [...REFLECTION_SECTIONS].reverse()) {
    if (
      !new RegExp(`^3\\s*[x×]\\s*${name}$`, 'i').test(
        (lines[preambleStart] ?? '').trim(),
      )
    ) {
      hasPreamble = false;
      break;
    }
    preambleStart--;
    while (preambleStart >= 0 && blank(lines[preambleStart])) preambleStart--;
  }
  if (hasPreamble) start = preambleStart + 1;
  let rule = start - 1;
  while (rule >= 0 && blank(lines[rule])) rule--;
  if (rule >= 0 && divider(lines[rule])) start = rule;
  return start;
}

/** Recognize complete exercises conservatively; unrecognized text stays ordinary Markdown. */
export function readingBlocks(body: string): ReadingBlock[] {
  const lines = body.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  offsets.push(body.length);
  const blocks: ReadingBlock[] = [];
  let consumed = 0;
  let fence: { character: string; length: number } | null = null;
  for (let title = 0; title < lines.length; title++) {
    const marker = lines[title].match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    if (
      /^(?:\\?={3,}\s*)?(?:3\s*[x×]\s*3|the\s+3\s+and\s+3)\s*>>>\s*SKIPPED$/i.test(
        heading(lines[title]),
      )
    ) {
      const start = Math.max(consumed, offsets[exerciseStart(lines, title)]);
      let after = title + 1;
      while (after < lines.length && blank(lines[after])) after++;
      const endLine =
        after < lines.length && divider(lines[after]) ? after + 1 : title + 1;
      const end = offsets[endLine];
      if (start > consumed)
        blocks.push({ type: 'markdown', text: body.slice(consumed, start) });
      blocks.push({ type: 'omitted', raw: body.slice(start, end) });
      consumed = end;
      title = endLine - 1;
      continue;
    }
    if (!isTitle(lines[title])) continue;
    let first = title + 1;
    while (
      first < Math.min(lines.length, title + 65) &&
      heading(lines[first]).toLowerCase() !== 'gratitude'
    ) {
      if (isTitle(lines[first]) || /^\s*(`{3,}|~{3,})/.test(lines[first]))
        break;
      first++;
    }
    if (
      first >= lines.length ||
      heading(lines[first]).toLowerCase() !== 'gratitude'
    )
      continue;
    let cursor = first;
    let end = first;
    const sections: ReflectionSection[] = [];
    for (const name of REFLECTION_SECTIONS) {
      if (heading(lines[cursor] ?? '').toLowerCase() !== name.toLowerCase())
        break;
      const result = readList(lines, cursor + 1);
      if (!result.items.length) break;
      sections.push({ name, items: result.items });
      cursor = result.next;
      end = result.end;
      while (cursor < lines.length && divider(lines[cursor])) {
        cursor++;
        while (cursor < lines.length && blank(lines[cursor])) cursor++;
      }
    }
    if (sections.length !== 3) continue;

    const start = exerciseStart(lines, title);
    // A closing rule belongs to the exercise; subsequent journal prose does not.
    let after = end;
    while (after < lines.length && blank(lines[after])) after++;
    if (after < lines.length && divider(lines[after])) end = after + 1;

    const startOffset = Math.max(consumed, offsets[start]);
    const endOffset = offsets[end];
    if (startOffset > consumed)
      blocks.push({
        type: 'markdown',
        text: body.slice(consumed, startOffset),
      });
    const intro = lines.slice(title + 1, first);
    while (intro.length && (blank(intro[0]) || divider(intro[0])))
      intro.shift();
    while (intro.length && (blank(intro.at(-1)!) || divider(intro.at(-1)!)))
      intro.pop();
    blocks.push({
      type: 'reflection',
      raw: body.slice(startOffset, endOffset),
      introduction: intro.join('\n'),
      sections,
    });
    consumed = endOffset;
    title = end - 1;
  }
  if (consumed < body.length)
    blocks.push({ type: 'markdown', text: body.slice(consumed) });
  return blocks.length ? blocks : [{ type: 'markdown', text: body }];
}
