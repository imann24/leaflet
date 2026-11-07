import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EntryBody } from './EntryBody';
import { HighlightedText } from './HighlightedText';

const render = (body: string, query: string) =>
  renderToStaticMarkup(
    <EntryBody body={body} query={query} onError={() => {}} />,
  );

describe('entry search rendering', () => {
  it('searches literal HTML without executing it or joining across visible tags', () => {
    const block = render('<div>word</div>', 'word');
    expect(block).toMatch(/&lt;div&gt;<mark[^>]+>word<\/mark>&lt;\/div&gt;/);
    expect(block).not.toContain('<div>word');
    expect(render('A <span>word</span> here', 'A word')).not.toContain('<mark');
    expect(render('A <span>word</span> here', '<span>')).toMatch(
      /<mark[^>]+>&lt;span&gt;<\/mark>/,
    );
  });
  it('highlights a phrase across Markdown without changing the original text or formatting', () => {
    const body = 'A **formatted** _phrase_ and a [link](https://example.com).';
    const html = render(body, 'a formatted phrase');
    const ids = [...html.matchAll(/data-entry-match="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(1);
    expect(html).toMatch(/<strong><mark[^>]+>formatted<\/mark><\/strong>/);
    expect(html).toMatch(/<em><mark[^>]+>phrase<\/mark><\/em>/);
    expect(html).toContain('href="https://example.com"');
    expect(body).toBe(
      'A **formatted** _phrase_ and a [link](https://example.com).',
    );
    expect(render(body, '')).not.toContain('<mark');
  });
  it('keeps punctuation literal and does not turn search text into HTML', () => {
    expect(
      render('Literal `[a-z]+.*?` and `[A-Z]+.*?`.', '[a-z]+.*?').match(
        /<mark /g,
      ),
    ).toHaveLength(2);
    expect(render('A safe entry.', '<script>')).not.toContain('<mark');
    expect(
      renderToStaticMarkup(
        <HighlightedText text="<script>alert(1)</script>" query="<script>" />,
      ),
    ).toContain('&lt;script&gt;</mark>');
  });
  it('searches image descriptions without joining text across placeholders', () => {
    expect(
      render(
        'before![the sea](https://example.com/image.png)after',
        'beforeafter',
      ),
    ).not.toContain('<mark');
    expect(render('![The SEA](https://example.com/image.png)', 'sea')).toMatch(
      /<mark[^>]+>SEA<\/mark>/,
    );
  });
  it('does not count empty-entry placeholder text as source content', () => {
    expect(render('', 'empty')).not.toContain('<mark');
  });
  it('retains raw source exactly, including headers and Markdown punctuation', () => {
    const source = 'FRIDAY\n8/10\n===\n**Memory** & <text>';
    const html = renderToStaticMarkup(
      <pre>
        <HighlightedText text={source} query="memory" />
      </pre>,
    );
    expect(html).toMatch(
      /\*\*<mark[^>]+>Memory<\/mark>\*\* &amp; &lt;text&gt;/,
    );
    expect(source).toContain('FRIDAY\n8/10\n===\n**Memory**');
  });
});
