import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

export function EntryFind({
  query,
  onQuery,
  onClose,
  content,
  input,
  revision,
}: {
  query: string;
  onQuery: (query: string) => void;
  onClose: () => void;
  content: RefObject<HTMLDivElement | null>;
  input: RefObject<HTMLInputElement | null>;
  revision: string;
}) {
  const [matches, setMatches] = useState<HTMLElement[][]>([]);
  const [index, setIndex] = useState(0);
  const previousFocus = useRef<Element | null>(null);
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement;
    input.current?.focus();
    return () => {
      if (
        previousFocus.current instanceof HTMLElement &&
        previousFocus.current.isConnected
      )
        previousFocus.current.focus({ preventScroll: true });
    };
  }, [input]);
  useLayoutEffect(() => {
    const groups = new Map<string, HTMLElement[]>();
    content.current
      ?.querySelectorAll<HTMLElement>('[data-entry-match]')
      .forEach((mark) => {
        const id = mark.dataset.entryMatch!;
        groups.set(id, [...(groups.get(id) ?? []), mark]);
      });
    setMatches([...groups.values()]);
    setIndex(0);
  }, [query, revision, content]);
  useLayoutEffect(() => {
    matches.forEach((marks, i) =>
      marks.forEach((mark) => {
        mark.dataset.active = String(i === index);
      }),
    );
    matches[index]?.[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [matches, index]);
  const move = (step: number) => {
    if (matches.length)
      setIndex((current) => (current + step + matches.length) % matches.length);
  };
  return (
    <div
      className="entry-find"
      role="search"
      aria-label="Find in current entry"
    >
      <Search size={16} aria-hidden="true" />
      <input
        ref={input}
        aria-label="Find in entry"
        aria-describedby="entry-find-status"
        placeholder="Find in this entry…"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            move(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span id="entry-find-status" role="status" aria-live="polite">
        {!query
          ? 'Type to find'
          : matches.length
            ? `${index + 1} of ${matches.length}`
            : 'No matches'}
      </span>
      <button
        className="icon-button"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={!matches.length}
        onClick={() => move(-1)}
      >
        <ChevronUp size={17} />
      </button>
      <button
        className="icon-button"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={!matches.length}
        onClick={() => move(1)}
      >
        <ChevronDown size={17} />
      </button>
      <button
        className="icon-button"
        aria-label="Close find"
        title="Close find (Escape)"
        onClick={onClose}
      >
        <X size={17} />
      </button>
    </div>
  );
}
