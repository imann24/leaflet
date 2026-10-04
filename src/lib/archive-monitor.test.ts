import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sameArchive, startArchiveMonitor } from './archive-monitor';
import type { Archive } from './journal';
const archive: Archive = {
  root: '/journal',
  entries: [
    {
      path: '2026-10-October/10.01.26.txt',
      name: '10.01.26.txt',
      month: '2026-10',
      content: 'An afternoon.',
    },
  ],
  warnings: [],
};
const cleanups: (() => void)[] = [];
function setup(
  load = vi.fn<() => Promise<Archive>>().mockResolvedValue(archive),
  watchWorks = true,
) {
  let changed = () => {};
  let failed = () => {};
  const stop = vi.fn();
  const onUpdate = vi.fn(),
    onError = vi.fn(),
    onMode = vi.fn();
  const subscribe = vi.fn(
    async (_root: string, change: () => void, failure: () => void) => {
      changed = change;
      failed = failure;
      if (!watchWorks) throw Error('Watcher unavailable');
      return stop;
    },
  );
  const monitor = startArchiveMonitor({
    root: archive.root,
    load,
    subscribe,
    onUpdate,
    onError,
    onMode,
  });
  cleanups.push(monitor.dispose);
  return {
    load,
    stop,
    onUpdate,
    onError,
    onMode,
    monitor,
    changed: () => changed(),
    failed: () => failed(),
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('archive refresh', () => {
  it('debounces bursts and reconciles once after watcher setup', async () => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.load).toHaveBeenCalledTimes(1);
    state.changed();
    await vi.advanceTimersByTimeAsync(300);
    state.changed();
    await vi.advanceTimersByTimeAsync(499);
    expect(state.load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.load).toHaveBeenCalledTimes(2);
    expect(state.onMode).toHaveBeenLastCalledWith('live');
  });
  it('checks every minute even when native subscription fails', async () => {
    const state = setup(undefined, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.onMode).toHaveBeenLastCalledWith('polling');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.load).toHaveBeenCalledTimes(2);
  });
  it('retains the last snapshot through errors and recovers on the next check', async () => {
    const load = vi
      .fn<() => Promise<Archive>>()
      .mockRejectedValueOnce(Error('Folder offline'))
      .mockResolvedValue(archive);
    const state = setup(load);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.onUpdate).not.toHaveBeenCalled();
    expect(state.onError).toHaveBeenLastCalledWith('Error: Folder offline');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.onUpdate).toHaveBeenCalledWith(archive);
    expect(state.onError).toHaveBeenLastCalledWith(null);
  });
  it('serializes scans and refreshes again for changes during a slow scan', async () => {
    let resolve!: (archive: Archive) => void;
    const load = vi
      .fn<() => Promise<Archive>>()
      .mockImplementationOnce(() => new Promise((done) => (resolve = done)))
      .mockResolvedValue(archive);
    const state = setup(load);
    await vi.advanceTimersByTimeAsync(0);
    state.changed();
    await vi.advanceTimersByTimeAsync(500);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(archive);
    await vi.advanceTimersByTimeAsync(500);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('ignores stale loads and releases subscriptions after disposal', async () => {
    let resolve!: (archive: Archive) => void;
    const state = setup(
      vi
        .fn<() => Promise<Archive>>()
        .mockImplementation(() => new Promise((done) => (resolve = done))),
    );
    await vi.advanceTimersByTimeAsync(0);
    state.monitor.dispose();
    resolve(archive);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.stop).toHaveBeenCalledTimes(1);
    expect(state.onUpdate).not.toHaveBeenCalled();
    expect(state.onError).not.toHaveBeenCalled();
    expect(state.load).toHaveBeenCalledTimes(1);
    cleanups.pop();
  });
  it('cleans up a watcher that finishes starting after its folder is replaced', async () => {
    let ready!: (stop: () => void) => void;
    const stop = vi.fn(),
      load = vi.fn();
    const monitor = startArchiveMonitor({
      root: '/old',
      load,
      subscribe: () => new Promise((resolve) => (ready = resolve)),
      onUpdate: vi.fn(),
      onError: vi.fn(),
      onMode: vi.fn(),
    });
    monitor.dispose();
    ready(stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(stop).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
  });
  it('keeps the safety check after a running watcher reports an error', async () => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(0);
    state.failed();
    expect(state.onMode).toHaveBeenLastCalledWith('polling');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.load.mock.calls.length).toBeGreaterThan(1);
  });
  it('avoids replacing identical snapshots but detects changed text and removals', () => {
    expect(sameArchive(archive, structuredClone(archive))).toBe(true);
    expect(sameArchive(archive, { ...archive, entries: [] })).toBe(false);
    expect(
      sameArchive(archive, {
        ...archive,
        entries: [{ ...archive.entries[0], content: 'Updated.' }],
      }),
    ).toBe(false);
    expect(
      sameArchive(archive, { ...archive, warnings: ['Unreadable entry'] }),
    ).toBe(false);
  });
});
