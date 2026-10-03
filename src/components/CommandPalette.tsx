import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, ArrowUpRight, Command } from 'lucide-react';
import { searchEntries, type Entry } from '../lib/journal';
export interface QuickCommand {
  id: string;
  label: string;
  detail: string;
  action: () => void;
}
export function CommandPalette({
  entries,
  commands,
  onSelect,
  onClose,
}: {
  entries: Entry[];
  commands: QuickCommand[];
  onSelect: (entry: Entry) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const commandMatches = commands
      .filter((c) =>
        c.label
          .toLowerCase()
          .includes(query.replace(/^>/, '').trim().toLowerCase()),
      )
      .map((c) => ({ ...c, kind: 'command' as const }));
    const entryMatches = query.startsWith('>')
      ? []
      : (query.trim()
          ? searchEntries(entries, query).slice(0, 40)
          : [...entries].reverse().slice(0, 5)
        ).map((e) => ({
          id: e.id,
          label: e.title,
          detail: `${e.name} · ${e.excerpt.slice(0, 80)}`,
          action: () => onSelect(e),
          kind: 'entry' as const,
        }));
    return [...commandMatches, ...entryMatches];
  }, [query, entries, commands, onSelect]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    input.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    dialog.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  return (
    <dialog
      ref={dialog}
      className="palette"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      aria-label="Command palette"
    >
      <div className="palette-search">
        <Search size={21} />
        <input
          ref={input}
          aria-label="Search entries and commands"
          placeholder="Find an entry, a memory, or a command…"
          value={query}
          onChange={(e) => {
            // Keep the query, visible results, and keyboard selection in one update.
            // Deferring results lets a quick Enter run an action from the old query.
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.max(0, Math.min(i + 1, results.length - 1)));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter' && results[index]) {
              e.preventDefault();
              results[index].action();
              onClose();
            }
          }}
        />
        <button className="key" onClick={onClose}>
          esc
        </button>
      </div>
      <div className="palette-results" role="listbox" aria-label="Results">
        <p className="eyebrow">
          {query
            ? `${results.length}${results.length >= 40 ? '+' : ''} results`
            : 'Quick commands & recent entries'}
        </p>
        {results.map((r, i) => (
          <button
            role="option"
            aria-selected={i === index}
            data-index={i}
            className={`command-result ${i === index ? 'active' : ''}`}
            key={r.id}
            onMouseMove={() => setIndex(i)}
            onClick={() => {
              r.action();
              onClose();
            }}
          >
            {r.kind === 'command' ? (
              <Command size={18} />
            ) : (
              <FileText size={18} />
            )}
            <span>
              <strong>{r.label}</strong>
              <small>{r.detail}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!results.length && (
          <div className="empty-small">
            No matching entries. Try a date, filename, or a few words.
          </div>
        )}
      </div>
      <footer>
        <span>↑ ↓ to navigate · ↵ to open</span>
        <span>Type &gt; for commands</span>
      </footer>
    </dialog>
  );
}
