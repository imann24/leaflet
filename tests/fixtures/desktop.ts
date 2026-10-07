// Test-only IPC harness. Loaded by Playwright before the app; never bundled into Leaflet.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { demo } from '../../src/lib/demo';
import type { SourceEntry } from '../../src/lib/journal';
const data = structuredClone(demo);
data.root = '/fictional/journal';
let nextId = 0;
let loads = 0;
const subscriptions = new Set<number>();
let rebuildCalls = 0;
let rebuildWorkspace = '';
let statusFailures = 0;
let statusCalls = 0;
let rebuildError: string | null = null;
let rebuildArgs: unknown;
const rebuildState = {
  phase: 'idle',
  workspace: '/fictional/leaflet',
  unavailableReason: null as string | null,
  error: null as string | null,
  log: '',
  logPath: '/fictional/logs/local-rebuild.log',
};
mockWindows('main');
mockIPC(
  (command, args) => {
    if (command === 'rebuild_status') {
      statusCalls++;
      if (statusFailures > 0) {
        statusFailures--;
        throw Error('Status temporarily unavailable');
      }
      return structuredClone(rebuildState);
    }
    if (command === 'choose_build_workspace') {
      rebuildState.workspace = '/fictional/Leaflet workspace';
      return rebuildState.workspace;
    }
    if (command === 'rebuild_app') {
      rebuildCalls++;
      rebuildArgs = args;
      if (rebuildError) throw Error(rebuildError);
      rebuildWorkspace = rebuildState.workspace;
      rebuildState.workspace = rebuildWorkspace;
      rebuildState.phase = 'building';
      rebuildState.error = null;
      rebuildState.log = 'Compiling Leaflet…';
      return null;
    }
    if (command === 'load_archive') {
      loads++;
      return structuredClone(data);
    }
    if (command === 'watch_archive') {
      if (
        (window as unknown as { watchUnavailable?: boolean }).watchUnavailable
      )
        throw Error('Watcher unavailable');
      const id = nextId++;
      subscriptions.add(id);
      return id;
    }
    if (command === 'unwatch_archive') {
      subscriptions.delete((args as { id: number }).id);
      return null;
    }
    return null;
  },
  { shouldMockEvents: true },
);
// isTauri() checks this flag independently of the IPC mock.
Object.defineProperty(window, 'isTauri', { value: true, configurable: true });
const harness = {
  get statusCalls() {
    return statusCalls;
  },
  failStatusPolls(count: number) {
    statusFailures = count;
  },
  failRebuild(message: string | null) {
    rebuildError = message;
  },
  get rebuildArgs() {
    return rebuildArgs;
  },
  get rebuildCalls() {
    return rebuildCalls;
  },
  get rebuildWorkspace() {
    return rebuildWorkspace;
  },
  setRebuild(patch: Partial<typeof rebuildState>) {
    Object.assign(rebuildState, patch);
  },
  async add(entry: SourceEntry, notify = true) {
    data.entries.push(entry);
    if (notify)
      await emit('journal-changed', { root: data.root, failed: false });
  },
  async update(name: string, content: string) {
    const entry = data.entries.find((entry) => entry.name === name)!;
    entry.content = content;
    await emit('journal-changed', { root: data.root, failed: false });
  },
  async remove(name: string) {
    data.entries = data.entries.filter((entry) => entry.name !== name);
    await emit('journal-changed', { root: data.root, failed: false });
  },
  async unrelated() {
    await emit('journal-changed', {
      root: '/different/journal',
      failed: false,
    });
  },
  get loads() {
    return loads;
  },
  get subscriptions() {
    return subscriptions.size;
  },
  async openRebuildFromMenu() {
    await emit('open-rebuild');
  },
};
Object.assign(window, { journalTest: harness });
declare global {
  interface Window {
    journalTest: typeof harness;
    watchUnavailable?: boolean;
  }
}
