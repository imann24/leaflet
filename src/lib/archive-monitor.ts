import type { Archive } from './journal';

export type MonitorMode = 'live' | 'polling';
export interface MonitorOptions {
  root: string;
  load: (root: string) => Promise<Archive>;
  subscribe: (
    root: string,
    onChange: () => void,
    onFailure: () => void,
    signal: AbortSignal,
  ) => Promise<() => void>;
  onUpdate: (archive: Archive) => void;
  onError: (error: string | null) => void;
  onMode: (mode: MonitorMode) => void;
}

export function sameArchive(previous: Archive | null, next: Archive) {
  return (
    previous?.root === next.root &&
    previous.entries.length === next.entries.length &&
    previous.warnings.join('\n') === next.warnings.join('\n') &&
    previous.entries.every((entry, index) => {
      const other = next.entries[index];
      return (
        entry.path === other.path &&
        entry.name === other.name &&
        entry.month === other.month &&
        entry.content === other.content
      );
    })
  );
}

/** One scan at a time; burst notifications settle before scanning, with a periodic safety net. */
export function startArchiveMonitor(options: MonitorOptions) {
  let disposed = false;
  const abort = new AbortController();
  let inFlight = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  const refresh = async () => {
    if (disposed) return;
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const archive = await options.load(options.root);
      if (!disposed) {
        options.onUpdate(archive);
        options.onError(null);
      }
    } catch (error) {
      if (!disposed) options.onError(String(error));
    } finally {
      inFlight = false;
      if (pending && !disposed) {
        pending = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 500);
  };
  const interval = setInterval(() => void refresh(), 60_000);
  options.onMode('polling');
  void options
    .subscribe(
      options.root,
      schedule,
      () => {
        if (!disposed) {
          options.onMode('polling');
          schedule();
        }
      },
      abort.signal,
    )
    .then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unsubscribe = stop;
      options.onMode('live');
      // Reconcile once after subscribing so changes during the initial load aren't lost.
      void refresh();
    })
    .catch(() => {
      if (!disposed) {
        options.onMode('polling');
        void refresh();
      }
    });
  return {
    refresh: schedule,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe?.();
    },
  };
}
