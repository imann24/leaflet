import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, X } from 'lucide-react';
import { readPreference, savePreference } from '../lib/archive';
import './RebuildDialog.css';

interface RebuildStatus {
  phase: 'idle' | 'building' | 'installing' | 'failed';
  workspace: string;
  unavailableReason: string | null;
  error: string | null;
  log: string;
  logPath: string | null;
}

export function RebuildDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<RebuildStatus | null>(null);
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const busy =
    submitting ||
    status?.phase === 'building' ||
    status?.phase === 'installing';
  useEffect(() => {
    dialog.current?.showModal();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh(initial = false) {
      try {
        const next = await invoke<RebuildStatus>('rebuild_status');
        if (disposed) return;
        setStatus(next);
        if (initial)
          setWorkspace(
            next.phase === 'building' || next.phase === 'installing'
              ? next.workspace
              : readPreference('buildWorkspace', next.workspace),
          );
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 1000);
      }
    }
    void refresh(true);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);

  async function chooseWorkspace() {
    try {
      const chosen = await open({
        directory: true,
        multiple: false,
        title: 'Choose the Leaflet workspace',
      });
      if (typeof chosen === 'string') {
        setWorkspace(chosen);
        savePreference('buildWorkspace', chosen);
        setError('');
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function rebuild() {
    setSubmitting(true);
    setError('');
    try {
      await invoke('rebuild_app', { workspace });
      savePreference('buildWorkspace', workspace);
      setStatus(await invoke<RebuildStatus>('rebuild_status'));
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="palette rebuild-dialog"
      aria-labelledby="rebuild-title"
      onCancel={onClose}
    >
      <header>
        <h2 id="rebuild-title">Rebuild app</h2>
        <button
          className="icon-button"
          aria-label="Close rebuild"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <p>
        Build the latest code in your local Leaflet workspace. After a
        successful build, Leaflet will update itself and restart.
      </p>
      <label htmlFor="build-workspace">Workspace folder</label>
      <div className="workspace-picker">
        <input
          id="build-workspace"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          disabled={busy}
          spellCheck={false}
          placeholder="Choose your Leaflet checkout"
        />
        <button
          className="icon-button"
          aria-label="Choose workspace folder"
          onClick={() => void chooseWorkspace()}
          disabled={busy}
        >
          <FolderOpen size={18} />
        </button>
      </div>
      <p className="build-hint">
        Uses this folder’s current code, including uncommitted edits. Choose a
        workspace you trust. Requires the same tools and dependencies as a
        terminal build.
      </p>
      {status?.unavailableReason && (
        <p className="notice">{status.unavailableReason}</p>
      )}
      {(error || status?.error) && (
        <p role="alert" className="notice error">
          {error || status?.error}
        </p>
      )}
      <p role="status">
        {busy
          ? status?.phase === 'installing'
            ? 'Installing… Leaflet will reopen shortly.'
            : 'Building… You can keep reading while the build runs.'
          : status?.phase === 'failed'
            ? 'Rebuild failed. See details above and the build output below.'
            : !status
              ? 'Checking local build support…'
              : 'Ready to build.'}
      </p>
      {status?.log && (
        <details open={status.phase === 'failed'}>
          <summary>Build output</summary>
          <pre tabIndex={0}>{status.log}</pre>
        </details>
      )}
      {status?.logPath && (
        <p className="build-hint build-log-path">Full log: {status.logPath}</p>
      )}
      <footer>
        <button onClick={onClose}>{busy ? 'Keep reading' : 'Close'}</button>
        <button
          className="primary"
          disabled={
            !status || !!status.unavailableReason || !workspace.trim() || busy
          }
          onClick={() => void rebuild()}
        >
          {busy ? 'Rebuilding…' : 'Rebuild & restart'}
        </button>
      </footer>
    </dialog>
  );
}
