export interface TextMatch {
  start: number;
  end: number;
}

/** Literal, case-insensitive matches with offsets in the original string. */
export function findTextMatches(text: string, query: string): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'giu',
  );
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

interface SearchNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: SearchNode[];
}

const blockTags = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
]);

/** Add marks to rendered Markdown, including matches spanning inline formatting. */
export function highlightEntryText(query: string, prefix: string) {
  return () => (tree: SearchNode) => {
    if (!query) return;
    let group = 0;
    let run: { node: SearchNode; parent: SearchNode; start: number }[] = [];
    let text = '';
    const flush = () => {
      const matches = findTextMatches(text, query).map((match) => ({
        ...match,
        id: `${prefix}-${group++}`,
      }));
      for (const { node, parent, start } of run) {
        const value = node.value!;
        const parts: SearchNode[] = [];
        let cursor = 0;
        for (const match of matches) {
          const from = Math.max(0, match.start - start);
          const to = Math.min(value.length, match.end - start);
          if (from >= to) continue;
          if (from > cursor)
            parts.push({ type: 'text', value: value.slice(cursor, from) });
          parts.push({
            type: 'element',
            tagName: 'mark',
            properties: { 'data-entry-match': match.id },
            children: [{ type: 'text', value: value.slice(from, to) }],
          });
          cursor = to;
        }
        if (!parts.length) continue;
        if (cursor < value.length)
          parts.push({ type: 'text', value: value.slice(cursor) });
        const index = parent.children!.indexOf(node);
        parent.children!.splice(index, 1, ...parts);
      }
      run = [];
      text = '';
    };
    const visit = (parent: SearchNode) => {
      // Work on a snapshot: flushing replaces text nodes in the original children.
      for (const node of [...(parent.children ?? [])]) {
        // ReactMarkdown displays raw HTML as literal text; search that same text.
        // Never parse it as HTML or make source tags executable.
        if (node.type === 'raw') node.type = 'text';
        if (node.type === 'text' && node.value) {
          run.push({ node, parent, start: text.length });
          text += node.value;
        } else {
          const boundary =
            node.tagName === 'br' ||
            node.tagName === 'img' ||
            node.tagName === 'input' ||
            blockTags.has(node.tagName ?? '');
          if (boundary) flush();
          visit(node);
          if (boundary) flush();
        }
      }
    };
    visit(tree);
    flush();
  };
}
