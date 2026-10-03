import { describe, expect, it } from 'vitest';
import {
  parseEntry,
  searchEntries,
  sortEntries,
  type SourceEntry,
} from './journal';
const source = (
  name = '10.02.26.txt',
  content = 'FRIDAY\n8.5/10\n===============\nA **good** day.',
  month = '2026-10',
): SourceEntry => ({ name, content, month, path: `${month}-Month/${name}` });
describe('archive conventions', () => {
  it('extracts metadata without changing the original text', () => {
    const s = source();
    const e = parseEntry(s);
    expect(e.date).toBe('2026-10-02');
    expect(e.rating).toBe(8.5);
    expect(e.weekday).toBe('FRIDAY');
    expect(e.body).toBe('A **good** day.');
    expect(e.content).toBe(s.content);
  });
  it('keeps separate numbered entries on the same day', () => {
    const entries = sortEntries(
      ['4.03.15.2.txt', '4.03.15.1.txt'].map((name) =>
        parseEntry(source(name, 'Text', '2015-04')),
      ),
    );
    expect(entries.map((e) => e.name)).toEqual([
      '4.03.15.1.txt',
      '4.03.15.2.txt',
    ]);
    expect(entries[0].date).toBe('2015-04-03');
    expect(entries[1].title).toContain('Part 2');
    expect(entries[0].id).not.toBe(entries[1].id);
  });
  it('preserves named notes without inventing a day', () => {
    const e = parseEntry(source('Goals.txt', 'A new idea.', '2022-03'));
    expect(e.date).toBeNull();
    expect(e.month).toBe('2022-03');
    expect(e.title).toBe('Goals');
  });
  it('does not roll invalid dates over or trust mismatched dates', () => {
    expect(
      parseEntry(source('2.30.26.txt', 'Text', '2026-02')).date,
    ).toBeNull();
    expect(
      parseEntry(source('2.28.26.txt', 'Text', '2026-03')).date,
    ).toBeNull();
    expect(parseEntry(source('2.29.24.txt', 'Text', '2024-02')).date).toBe(
      '2024-02-29',
    );
  });
  it('handles BOM, CRLF, whitespace, and old indented prose', () => {
    const e = parseEntry(
      source(
        '10.02.26.txt',
        '\uFEFF\r\nFRIDAY\r\n\r\n7.75/10\r\n=====\r\n\tA quiet afternoon.',
      ),
    );
    expect(e.rating).toBe(7.75);
    expect(e.body).toBe('A quiet afternoon.');
    expect(parseEntry(source('10.02.26.md', '\tcode')).body).toBe('\tcode');
  });
  it('preserves non-header scores and rejects out-of-range ratings', () => {
    expect(parseEntry(source('10.02.26.txt', '12/10\nThoughts')).body).toBe(
      '12/10\nThoughts',
    );
    const e = parseEntry(source('10.02.26.txt', 'FRIDAY\n12/10\nThoughts'));
    expect(e.rating).toBeNull();
    expect(e.body).toContain('12/10');
  });
  it('sorts chronologically across years with notes after dated entries', () => {
    const entries = sortEntries([
      parseEntry(source('Goals.txt', '')),
      parseEntry(source()),
      parseEntry(source('9.30.26.txt', 'Text', '2026-09')),
    ]);
    expect(entries.map((e) => e.name)).toEqual([
      '9.30.26.txt',
      '10.02.26.txt',
      'Goals.txt',
    ]);
  });
  it('searches filenames, dates, names, and body text', () => {
    const entries = [
      parseEntry(source()),
      parseEntry(source('Goals.txt', 'Visit the quiet coast.')),
    ];
    for (const query of ['10.02.26', '2026-10-02', 'October 2 2026', 'GOOD'])
      expect(searchEntries(entries, query)[0]?.name).toBe('10.02.26.txt');
    expect(searchEntries(entries, 'quiet coast')[0]?.title).toBe('Goals');
    expect(searchEntries(entries, 'absent')).toEqual([]);
  });
});
