import { describe, expect, it } from 'vitest';
import { readingBlocks, type ReadingBlock } from './reflection';
const exercise = `===============
3 x Gratitude
3 x Forgiveness
3 x Curiosity

# the 3 and 3

GRATITUDE

1. A warm **coffee**.
2. A friend's kindness.
3. An afternoon outside.

FORGIVENESS

1. Taking my time.
2. Changing my mind.
3. Needing a break.

CURIOSITY

1. What tomorrow brings.
2. Where that path leads.
3. How the garden grows.

===============`;
const reflection = (blocks: ReadingBlock[]) =>
  blocks.find((block) => block.type === 'reflection');
const reconstruct = (blocks: ReadingBlock[]) =>
  blocks
    .map((block) => (block.type === 'markdown' ? block.text : block.raw))
    .join('');
describe('The 3 and 3', () => {
  it('recognizes the exercise and replaces its repetitive preamble', () => {
    const blocks = readingBlocks(exercise);
    expect(blocks).toHaveLength(1);
    const block = reflection(blocks)!;
    expect(block.sections.map((section) => section.name)).toEqual([
      'Gratitude',
      'Forgiveness',
      'Curiosity',
    ]);
    expect(block.sections.map((section) => section.items.length)).toEqual([
      3, 3, 3,
    ]);
    expect(block.sections[0].items[0].text).toBe('A warm **coffee**.');
    expect(reconstruct(blocks)).toBe(exercise);
  });
  it('keeps surrounding prose outside the exercise, with or without closing rules', () => {
    for (const text of [exercise, exercise.replace(/\n=+$/, '')]) {
      const body = `An ordinary morning.\n\n${text}\n\nAnd then I went for a walk.`;
      const blocks = readingBlocks(body);
      expect(blocks[0]).toEqual({
        type: 'markdown',
        text: 'An ordinary morning.\n\n',
      });
      expect(blocks.at(-1)?.type).toBe('markdown');
      expect(reflection(blocks)!.sections[2].items[2].text).toBe(
        'How the garden grows.',
      );
      expect(reconstruct(blocks)).toBe(body);
    }
  });
  it('supports older plain headings and introduction paragraphs after the title', () => {
    const body = exercise.replace(
      '# the 3 and 3',
      'the 3 and 3\n===============\n\nA new daily practice.',
    );
    const block = reflection(readingBlocks(body))!;
    expect(block.introduction).toBe('A new daily practice.');
    expect(reconstruct(readingBlocks(body))).toBe(body);
  });
  it('keeps extra items and wrapped list text', () => {
    const body = exercise.replace(
      '3. Needing a break.',
      '3. Needing a break.\n   And some fresh air.\n\n   A little space.\n4. Starting again.',
    );
    const items = reflection(readingBlocks(body))!.sections[1].items;
    expect(items).toHaveLength(4);
    expect(items[2].text).toBe(
      'Needing a break.\nAnd some fresh air.\n\nA little space.',
    );
    expect(items[3]).toEqual({ number: 4, text: 'Starting again.' });
  });
  it('leaves skipped, incomplete, and unrelated content in regular Markdown', () => {
    for (const body of [
      exercise.replace('CURIOSITY\n', 'OTHER\n'),
      'GRATITUDE\n1. A good day.',
      exercise.replace(/1\. Taking my time\.[\s\S]*?CURIOSITY/, 'CURIOSITY'),
    ]) {
      expect(readingBlocks(body)).toEqual([{ type: 'markdown', text: body }]);
    }
  });
  it('does not turn a fenced example into a reflection', () => {
    const body = `\`\`\`text\n${exercise}\n\`\`\``;
    expect(readingBlocks(body)).toEqual([{ type: 'markdown', text: body }]);
  });
  it('recognizes Markdown headings, escaped rules, and CRLF while retaining source', () => {
    const body = exercise
      .replaceAll('===============', '\\===============')
      .replace('GRATITUDE\n', '## Gratitude\n')
      .replace('FORGIVENESS\n', '## Forgiveness\n')
      .replace('CURIOSITY\n', '## Curiosity\n')
      .replaceAll('\n', '\r\n');
    expect(reflection(readingBlocks(body))!.sections).toHaveLength(3);
    expect(reconstruct(readingBlocks(body))).toBe(body);
  });
  it('renders multiple exercises without losing the text between them', () => {
    const body = `${exercise}\n\nA second thought.\n\n${exercise}`;
    expect(
      readingBlocks(body).filter((b) => b.type === 'reflection'),
    ).toHaveLength(2);
    expect(reconstruct(readingBlocks(body))).toBe(body);
  });
});

describe('skipped exercise markers', () => {
  it('omits only the skipped line, retaining surrounding paragraphs and original text', () => {
    for (const marker of [
      '# =============== 3x3 >>> SKIPPED',
      '=============== 3x3 >>> SKIPPED',
      '## =============== 3 x 3 >>> skipped',
    ]) {
      const body = `Before the exercise.\n\n${marker}\n\nAfter the exercise.`;
      const blocks = readingBlocks(body);
      expect(blocks.filter((block) => block.type === 'omitted')).toHaveLength(
        1,
      );
      expect(
        blocks
          .filter((block) => block.type === 'markdown')
          .map((block) => block.text)
          .join(''),
      ).toBe('Before the exercise.\n\n\nAfter the exercise.');
      expect(reconstruct(blocks)).toBe(body);
    }
  });
  it('preserves mentions in prose and code examples', () => {
    for (const body of [
      'I wrote =============== 3x3 >>> SKIPPED today.',
      '```\n# =============== 3x3 >>> SKIPPED\n```',
    ]) {
      expect(readingBlocks(body)).toEqual([{ type: 'markdown', text: body }]);
    }
  });
});

it('hides skipped blocks with separate rules and the older preamble', () => {
  for (const marker of [
    '===============\n3x3 >>> SKIPPED\n===============',
    '===============\n3 x Gratitude\n3 x Forgiveness\n3 x Curiosity\n\nthe 3 and 3 >>> SKIPPED\n===============',
    '3X3 >>> SKIPPED  \n===============',
  ]) {
    const body = `${marker}\n\nAn ordinary afternoon.`;
    const blocks = readingBlocks(body);
    expect(blocks[0].type).toBe('omitted');
    expect(
      blocks
        .filter((b) => b.type === 'markdown')
        .map((b) => b.text)
        .join(''),
    ).toBe('\nAn ordinary afternoon.');
    expect(reconstruct(blocks)).toBe(body);
  }
});
