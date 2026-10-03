import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderOpen,
  Leaf,
  Maximize2,
  Minimize2,
  Search,
  Shuffle,
  Sun,
  Moon,
  RotateCw,
  X,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  chooseArchive,
  desktop,
  loadArchive,
  readPreference,
  savePreference,
} from './lib/archive';
import {
  dateValue,
  MONTHS,
  monthLabel,
  parseEntry,
  sortEntries,
  type Archive,
  type Entry,
} from './lib/journal';
import { Calendar } from './components/Calendar';
import { CommandPalette } from './components/CommandPalette';
import { EntryBody } from './components/EntryBody';
import './App.css';

type View = 'journal' | 'calendar' | 'bookmarks' | 'anniversary';
export default function App() {
  const [archive, setArchive] = useState<Archive | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [view, setView] = useState<View>('journal');
  const [palette, setPalette] = useState(false);
  const [focus, setFocus] = useState(false);
  const [raw, setRaw] = useState(false);
  const [fontSize, setFontSize] = useState(() =>
    readPreference('fontSize', 18),
  );
  const [dark, setDark] = useState(() => readPreference('dark', false));
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const reader = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const entries = useMemo(
    () => sortEntries((archive?.entries ?? []).map(parseEntry)),
    [archive],
  );
  const months = useMemo(
    () => Array.from(new Set(entries.map((e) => e.month))),
    [entries],
  );
  const years = useMemo(
    () => Array.from(new Set(months.map((m) => m.slice(0, 4)))).reverse(),
    [months],
  );
  const entry = entries.find((e) => e.id === selected);
  const today = new Date();
  const anniversary = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const visible = useMemo(
    () =>
      entries.filter((e) =>
        view === 'bookmarks'
          ? bookmarks.includes(e.id)
          : view === 'anniversary'
            ? e.date?.slice(5) === anniversary
            : e.month === month,
      ),
    [entries, view, bookmarks, month, anniversary],
  );
  const position = visible.findIndex((e) => e.id === selected);
  const monthEntries = useMemo(
    () => entries.filter((e) => e.month === month),
    [entries, month],
  );
  const rootKey = archive?.root ?? '';
  const load = useCallback(async (root?: string) => {
    const request = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const data = await loadArchive(root);
      if (request !== requestId.current) return;
      const parsed = sortEntries(data.entries.map(parseEntry));
      const last = readPreference<string>(`last:${data.root}`, '');
      const initial = parsed.find((e) => e.id === last) ?? parsed.at(-1);
      setArchive(data);
      setSelected(initial?.id ?? '');
      setMonth(initial?.month ?? '');
      setYear(initial?.month.slice(0, 4) ?? '');
      setBookmarks(readPreference<string[]>(`bookmarks:${data.root}`, []));
      setView('journal');
      setFocus(false);
      if (desktop) savePreference('root', data.root);
    } catch (e) {
      if (request === requestId.current) setError(String(e));
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load(readPreference<string>('root', ''));
  }, [load]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    savePreference('dark', dark);
    if (desktop) {
      void getCurrentWindow()
        .setTheme(dark ? 'dark' : 'light')
        .catch(() => {
          // The reader theme still works on platforms without native theme control.
        });
    }
  }, [dark]);
  useEffect(() => savePreference('fontSize', fontSize), [fontSize]);
  useEffect(() => {
    if (selected && rootKey) savePreference(`last:${rootKey}`, selected);
  }, [selected, rootKey]);
  useEffect(() => {
    reader.current?.scrollTo({ top: 0 });
    setRaw(false);
    document
      .querySelector('.entry-card.selected')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const openEntry = useCallback((e: Entry) => {
    setSelected(e.id);
    setMonth(e.month);
    setYear(e.month.slice(0, 4));
    setView('journal');
  }, []);
  const selectMonth = (m: string) => {
    setMonth(m);
    setYear(m.slice(0, 4));
    setView('journal');
    setSelected(entries.find((e) => e.month === m)?.id ?? '');
  };
  const changeView = (v: View) => {
    setView(v);
    setFocus(false);
    if (v === 'bookmarks')
      setSelected(entries.find((e) => bookmarks.includes(e.id))?.id ?? '');
    if (v === 'anniversary')
      setSelected(
        entries.find((e) => e.date?.slice(5) === anniversary)?.id ?? '',
      );
    if (v === 'journal' && !monthEntries.some((e) => e.id === selected))
      setSelected(monthEntries[0]?.id ?? '');
  };
  const page = (step: number) => {
    const next = visible[position + step];
    if (next) setSelected(next.id);
  };
  const toggleBookmark = () => {
    if (!entry) return;
    setBookmarks((prev) => {
      const next = prev.includes(entry.id)
        ? prev.filter((id) => id !== entry.id)
        : [...prev, entry.id];
      savePreference(`bookmarks:${rootKey}`, next);
      return next;
    });
  };
  const choose = async () => {
    try {
      const root = await chooseArchive();
      if (root) await load(root);
    } catch (e) {
      setError(String(e));
    }
  };
  const randomEntry = () => {
    if (entries.length)
      openEntry(entries[Math.floor(Math.random() * entries.length)]);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (
        palette ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        page(-1);
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        page(1);
      }
      if (e.key === 'Escape') setFocus(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const commands = [
    {
      id: 'calendar',
      label: 'Open calendar',
      detail: 'Jump to a year, month, or day',
      action: () => changeView('calendar'),
    },
    {
      id: 'random',
      label: 'Surprise me',
      detail: 'Rediscover a random entry',
      action: randomEntry,
    },
    {
      id: 'today',
      label: 'On this day',
      detail: 'The same date through the years',
      action: () => changeView('anniversary'),
    },
    {
      id: 'bookmarks',
      label: 'Show bookmarks',
      detail: 'Return to saved memories',
      action: () => changeView('bookmarks'),
    },
    {
      id: 'focus',
      label: focus ? 'Leave focus mode' : 'Focus on reading',
      detail: 'A little more space for your words',
      action: () => setFocus((f) => !f),
    },
    {
      id: 'refresh',
      label: 'Refresh journal',
      detail: 'Read changes from your journal folder',
      action: () => void load(archive?.root),
    },
    {
      id: 'theme',
      label: dark ? 'Switch to light mode' : 'Switch to dark mode',
      detail: 'Change the reading atmosphere',
      action: () => setDark((d) => !d),
    },
    ...(desktop
      ? [
          {
            id: 'folder',
            label: 'Choose journal folder',
            detail: 'Open a local archive',
            action: () => void choose(),
          },
        ]
      : []),
  ];
  const collectionTitle =
    view === 'bookmarks'
      ? 'Bookmarks'
      : view === 'anniversary'
        ? 'On this day'
        : month
          ? monthLabel(month)
          : 'Your journal';
  return (
    <div className={`app ${focus && view !== 'calendar' ? 'focus-mode' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Leaf size={23} />
          </div>
          <span>
            leaflet<span className="brand-dot">.</span>
          </span>
        </div>
        <button className="search-launch" onClick={() => setPalette(true)}>
          <Search size={16} />
          <span>Find a memory</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={view === 'journal' ? 'active' : ''}
            onClick={() => changeView('journal')}
          >
            <BookOpen size={18} />
            Journal<span>{entries.length.toLocaleString()}</span>
          </button>
          <button
            className={view === 'calendar' ? 'active' : ''}
            onClick={() => changeView('calendar')}
          >
            <CalendarDays size={18} />
            Calendar
          </button>
          <button
            className={view === 'anniversary' ? 'active' : ''}
            onClick={() => changeView('anniversary')}
          >
            <Clock3 size={18} />
            On this day
          </button>
          <button
            className={view === 'bookmarks' ? 'active' : ''}
            onClick={() => changeView('bookmarks')}
          >
            <Bookmark size={18} />
            Bookmarks<span>{bookmarks.length || ''}</span>
          </button>
        </nav>
        <div className="archive-label">
          <span className="eyebrow">YOUR ARCHIVE</span>
          <select
            aria-label="Archive year"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              const m = months.find((m) => m.startsWith(e.target.value));
              if (m) selectMonth(m);
            }}
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="month-nav">
          {MONTHS.map((label, i) => {
            const m = `${year}-${String(i + 1).padStart(2, '0')}`;
            const count = entries.filter((e) => e.month === m).length;
            return (
              <button
                key={label}
                disabled={!count}
                className={month === m && view === 'journal' ? 'active' : ''}
                onClick={() => selectMonth(m)}
              >
                <span>{label}</span>
                <span>{count || '—'}</span>
              </button>
            );
          })}
        </div>
        <div className="sidebar-bottom">
          <button
            className="surprise"
            onClick={randomEntry}
            disabled={!entries.length}
          >
            <Shuffle size={16} />
            Surprise me
            <ArrowRight size={16} />
          </button>
          <div className="folder-status">
            <span className="status-dot" />
            <span title={archive?.root}>
              {desktop ? 'Local journal' : 'Demo journal'}
            </span>
            <button
              title="Refresh journal"
              aria-label="Refresh journal"
              disabled={busy}
              onClick={() => void load(archive?.root)}
            >
              <RotateCw size={14} />
            </button>
            <button
              title={
                desktop
                  ? 'Choose journal folder'
                  : 'Open the desktop app to choose a folder'
              }
              aria-label="Choose journal folder"
              disabled={!desktop || busy}
              onClick={() => void choose()}
            >
              <FolderOpen size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">Your journal</span>
            <ChevronRight size={13} />
            <strong>
              {view === 'calendar' ? 'Calendar' : collectionTitle}
            </strong>
          </div>
          <div className="topbar-actions">
            {!desktop && <span className="demo-badge">Fictional demo</span>}
            <button
              className="icon-button"
              aria-label={dark ? 'Use light mode' : 'Use dark mode'}
              onClick={() => setDark((d) => !d)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        {error && (
          <div className="notice error" role="alert">
            <span>{error}</span>
            <button onClick={() => void choose()}>Choose folder</button>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {archive?.warnings.length ? (
          <details className="notice">
            <summary>
              {archive.warnings.length} files or folders could not be read
            </summary>
            {archive.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
        ) : null}
        {busy ? (
          <div className="loading">
            <Leaf size={32} />
            <h2>Opening your journal…</h2>
            <p>A moment to gather your memories.</p>
          </div>
        ) : !entries.length ? (
          <div className="loading">
            <FolderOpen size={32} />
            <h2>A home for your memories.</h2>
            <p>Choose a folder with monthly subfolders like 2026-10-October.</p>
            <button className="primary" onClick={() => void choose()}>
              Choose journal folder
            </button>
          </div>
        ) : view === 'calendar' ? (
          <section className="calendar-view">
            <div className="calendar-heading">
              <div>
                <p className="eyebrow">THE BIG PICTURE</p>
                <h1>A life in days.</h1>
                <p>Pick a date. See where it takes you.</p>
              </div>
              <div className="year-picker">
                <button
                  aria-label="Previous year"
                  disabled={years.indexOf(year) === years.length - 1}
                  onClick={() => setYear(years[years.indexOf(year) + 1])}
                >
                  <ChevronLeft size={18} />
                </button>
                <select
                  aria-label="Calendar year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                >
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
                <button
                  aria-label="Next year"
                  disabled={years.indexOf(year) <= 0}
                  onClick={() => setYear(years[years.indexOf(year) - 1])}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="year-summary">
              <span className="status-dot" />
              {entries.filter((e) => e.month.startsWith(year)).length} entries
              in {year}
              <span>·</span>Days with an entry are highlighted
            </div>
            <div className="year-grid">
              {MONTHS.map((label, i) => {
                const m = `${year}-${String(i + 1).padStart(2, '0')}`;
                const count = entries.filter((e) => e.month === m).length;
                return (
                  <div
                    className={`month-card ${count ? '' : 'no-entries'}`}
                    key={label}
                  >
                    <button
                      className="month-card-title"
                      onClick={() => selectMonth(m)}
                    >
                      <h3>{label}</h3>
                      <span>
                        {count} entries
                        <ArrowUpSmall />
                      </span>
                    </button>
                    <Calendar
                      month={m}
                      entries={entries}
                      selected={selected}
                      onSelect={openEntry}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="reading-layout">
            <section className="entry-column" aria-label="Entry list">
              <div className="entry-column-heading">
                <p className="eyebrow">
                  {view === 'journal'
                    ? 'ONE MONTH AT A TIME'
                    : 'WORTH REVISITING'}
                </p>
                <div>
                  <h2>{collectionTitle}</h2>
                  {view === 'journal' && (
                    <div className="month-arrows">
                      <button
                        aria-label="Previous month"
                        disabled={months.indexOf(month) <= 0}
                        onClick={() =>
                          selectMonth(months[months.indexOf(month) - 1])
                        }
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        aria-label="Next month"
                        disabled={months.indexOf(month) === months.length - 1}
                        onClick={() =>
                          selectMonth(months[months.indexOf(month) + 1])
                        }
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
                <p>
                  {visible.length} {visible.length === 1 ? 'entry' : 'entries'}
                  {view === 'anniversary'
                    ? ` · ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
                    : ''}
                </p>
              </div>
              {view === 'journal' && month && (
                <Calendar
                  compact
                  month={month}
                  entries={monthEntries}
                  selected={selected}
                  onSelect={openEntry}
                />
              )}
              <div className="entry-list">
                {visible.map((e) => (
                  <button
                    key={e.id}
                    className={`entry-card ${e.id === selected ? 'selected' : ''}`}
                    onClick={() => setSelected(e.id)}
                    aria-current={e.id === selected ? 'true' : undefined}
                  >
                    <div className="entry-card-date">
                      <strong>
                        {e.date
                          ? dateValue(e.date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              ...(view !== 'journal'
                                ? { year: 'numeric' }
                                : {}),
                            })
                          : e.title}
                      </strong>
                      <span>
                        {bookmarks.includes(e.id) && (
                          <Bookmark size={12} fill="currentColor" />
                        )}
                        {e.rating !== null ? `${e.rating}/10` : ''}
                      </span>
                    </div>
                    <span className="entry-weekday">
                      {e.date
                        ? dateValue(e.date).toLocaleDateString('en-US', {
                            weekday: 'long',
                          })
                        : 'MONTH NOTE'}
                      {e.name.match(/\.\d+\.txt$/) && e.title.includes('Part')
                        ? ` · ${e.title.split(' · ')[1]}`
                        : ''}
                    </span>
                    <p>{e.excerpt || 'An empty page.'}</p>
                  </button>
                ))}
                {!visible.length && (
                  <div className="empty-small">
                    {view === 'bookmarks'
                      ? 'Save an entry with the bookmark button. You’ll find it here.'
                      : view === 'anniversary'
                        ? 'No entries for this date yet. Try a random memory.'
                        : 'No entries in this month.'}
                  </div>
                )}
              </div>
              <div className="list-footer">
                <Leaf size={13} />
                <span>A little of your life, kept.</span>
              </div>
            </section>
            <section className="reader-shell" aria-label="Journal reader">
              <div className="reader-toolbar">
                <span>
                  {entry
                    ? `${Math.max(1, Math.ceil(entry.words / 220))} min read`
                    : 'Your reading space'}
                </span>
                <div>
                  <button
                    className={`icon-button ${raw ? 'toggled' : ''}`}
                    aria-label={
                      raw ? 'Show rendered entry' : 'Show original text'
                    }
                    title="Original text"
                    onClick={() => setRaw((r) => !r)}
                    disabled={!entry}
                  >
                    <span className="text-icon">Aa</span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Decrease text size"
                    onClick={() => setFontSize((s) => Math.max(15, s - 1))}
                    disabled={fontSize <= 15}
                  >
                    <span className="text-icon small">A−</span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Increase text size"
                    onClick={() => setFontSize((s) => Math.min(24, s + 1))}
                    disabled={fontSize >= 24}
                  >
                    <span className="text-icon">A+</span>
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className={`icon-button ${entry && bookmarks.includes(entry.id) ? 'toggled' : ''}`}
                    aria-label={
                      entry && bookmarks.includes(entry.id)
                        ? 'Remove bookmark'
                        : 'Bookmark entry'
                    }
                    disabled={!entry}
                    onClick={toggleBookmark}
                  >
                    <Bookmark
                      size={17}
                      fill={
                        entry && bookmarks.includes(entry.id)
                          ? 'currentColor'
                          : 'none'
                      }
                    />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={focus ? 'Leave focus mode' : 'Focus mode'}
                    onClick={() => setFocus((f) => !f)}
                  >
                    {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                  </button>
                </div>
              </div>
              <div className="reader-scroll" ref={reader}>
                {entry ? (
                  <article className="entry-content">
                    <div className="entry-kicker">
                      <span className="tiny-line" />
                      {entry.date
                        ? dateValue(entry.date).toLocaleDateString('en-US', {
                            weekday: 'long',
                          })
                        : 'A NOTE TO REMEMBER'}
                    </div>
                    <h1>{entry.title.replace(/, \d{4}/, '')}</h1>
                    <div className="entry-meta">
                      <span>
                        {entry.date
                          ? dateValue(entry.date).toLocaleDateString('en-US', {
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : monthLabel(entry.month)}
                      </span>
                      <span>·</span>
                      <span>{entry.words.toLocaleString()} words</span>
                      {entry.rating !== null && (
                        <span className="rating">
                          <Sun size={13} />
                          {entry.rating}
                          <span>/ 10</span>
                        </span>
                      )}
                    </div>
                    <div className="entry-rule" />
                    <div className="prose" style={{ fontSize }}>
                      {raw ? (
                        <pre className="raw-text">{entry.content}</pre>
                      ) : (
                        <EntryBody body={entry.body} onError={setError} />
                      )}
                    </div>
                    <div className="entry-end">
                      <Leaf size={16} />
                    </div>
                    <div className="source-file" title={entry.path}>
                      {entry.name}
                      <span>
                        <Check size={12} /> Read-only original
                      </span>
                    </div>
                  </article>
                ) : (
                  <div className="loading">
                    <BookOpen size={30} />
                    <h2>A memory is a click away.</h2>
                    <p>Choose an entry to settle in.</p>
                  </div>
                )}
              </div>
              <footer className="reader-footer">
                <button onClick={() => page(-1)} disabled={position <= 0}>
                  <ArrowLeft size={16} />
                  <span>Previous entry</span>
                </button>
                <span>
                  {position >= 0 ? `${position + 1} of ${visible.length}` : '—'}
                  <small>⌥ ← / →</small>
                </span>
                <button
                  onClick={() => page(1)}
                  disabled={position < 0 || position >= visible.length - 1}
                >
                  <span>Next entry</span>
                  <ArrowRight size={16} />
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
      {palette && (
        <CommandPalette
          entries={entries}
          commands={commands}
          onSelect={openEntry}
          onClose={() => setPalette(false)}
        />
      )}
    </div>
  );
}
function ArrowUpSmall() {
  return <span aria-hidden="true">↗</span>;
}
