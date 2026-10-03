import { MONTHS, type Entry } from '../lib/journal';
export function Calendar({
  month,
  entries,
  selected,
  onSelect,
  compact = false,
}: {
  month: string;
  entries: Entry[];
  selected?: string | null;
  onSelect: (entry: Entry) => void;
  compact?: boolean;
}) {
  const [year, number] = month.split('-').map(Number);
  const offset = (new Date(year, number - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, number, 0).getDate();
  const byDay = new Map<number, Entry[]>();
  entries
    .filter((e) => e.month === month && e.date)
    .forEach((e) => {
      const day = Number(e.date!.slice(-2));
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    });
  return (
    <div className={`calendar ${compact ? 'compact' : ''}`}>
      <div className="weekdays">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="days">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const items = byDay.get(i + 1) ?? [];
          const active = items.some((e) => e.id === selected);
          return (
            <button
              key={i}
              disabled={!items.length}
              className={`${items.length ? 'has-entry' : ''} ${active ? 'selected' : ''}`}
              title={`${MONTHS[number - 1]} ${i + 1}, ${year} · ${items.length} ${items.length === 1 ? 'entry' : 'entries'}`}
              aria-label={`${MONTHS[number - 1]} ${i + 1}, ${year}, ${items.length} entries`}
              onClick={() => onSelect(items[0])}
            >
              <span>{i + 1}</span>
              {items.length > 0 && <i />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
