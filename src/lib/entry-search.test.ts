import { describe, expect, it } from 'vitest';
import { findTextMatches, highlightEntryText } from './entry-search';

describe('findTextMatches', () => {
  it('finds case-insensitive literal matches in order', () => {
    expect(findTextMatches('Leaf leaf LEAF', 'lEaF')).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ]);
  });
  it('treats regex punctuation literally', () => {
    const text = 'a.b [a] (a) a+b $5 ^x ? * \\ {1} |';
    for (const query of [
      'a.b',
      '[a]',
      '(a)',
      'a+b',
      '$5',
      '^x',
      '?',
      '*',
      '\\',
      '{1}',
      '|',
    ]) {
      const start = text.indexOf(query);
      expect(findTextMatches(text, query)).toEqual([
        { start, end: start + query.length },
      ]);
    }
  });
  it('does not tokenize or trim the query', () => {
    expect(
      findTextMatches('one and two. one two. one  two.', 'one two'),
    ).toEqual([{ start: 13, end: 20 }]);
    expect(findTextMatches('one two', ' two ')).toEqual([]);
    expect(findTextMatches('one two', ' ')).toEqual([{ start: 3, end: 4 }]);
  });
  it('handles empty queries, missing matches, and non-overlapping matches', () => {
    expect(findTextMatches('text', '')).toEqual([]);
    expect(findTextMatches('', 'text')).toEqual([]);
    expect(findTextMatches('text', 'missing')).toEqual([]);
    expect(findTextMatches('aaaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
  it('keeps original UTF-16 offsets when case conversion changes string length', () => {
    const text = 'İ 😀 CAFÉ café';
    expect(
      findTextMatches(text, 'café').map(({ start, end }) =>
        text.slice(start, end),
      ),
    ).toEqual(['CAFÉ', 'café']);
    expect(findTextMatches(text, '😀')).toEqual([{ start: 2, end: 4 }]);
  });
});

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}
const text = (value: string): Node => ({ type: 'text', value });
const element = (tagName: string, ...children: Node[]): Node => ({
  type: 'element',
  tagName,
  children,
});
const marks = (node: Node): Node[] =>
  node.tagName === 'mark' ? [node] : (node.children ?? []).flatMap(marks);

describe('rendered entry highlighting', () => {
  it('groups one phrase spanning inline formatting into one match', () => {
    const tree = element(
      'p',
      text('A '),
      element('strong', text('good')),
      text(' day and GOOD day.'),
    );
    highlightEntryText('good day', 'entry')()(tree);
    expect(
      marks(tree).map((mark) => [
        mark.children?.[0].value,
        mark.properties?.['data-entry-match'],
      ]),
    ).toEqual([
      ['good', 'entry-0'],
      [' day', 'entry-0'],
      ['GOOD day', 'entry-1'],
    ]);
  });
  it('does not join words across paragraphs or hard line breaks', () => {
    const tree = element(
      'div',
      element('p', text('good')),
      element('p', text('day')),
      element('p', text('good'), element('br'), text('day')),
    );
    highlightEntryText('goodday', 'entry')()(tree);
    expect(marks(tree)).toEqual([]);
  });
  it('never searches link destinations or markup syntax', () => {
    const tree = element('p', {
      ...element('a', text('a link')),
      properties: { href: 'https://hidden.example' },
    });
    highlightEntryText('hidden', 'entry')()(tree);
    expect(marks(tree)).toEqual([]);
  });
});
