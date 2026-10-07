# Leaflet

A quiet, local desktop reader for revisiting a plain-text journal. Built with Tauri 2, React, TypeScript, and Vite. Uses **pnpm**.

## Run

Prerequisites: Node.js 20.19+ (or 22.12+), pnpm via Corepack, stable Rust, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). On macOS, Xcode command-line tools are required.

```sh
# If Rust was just installed and cargo isn't on PATH:
source "$HOME/.cargo/env"

pnpm install
pnpm desktop
```

The desktop app initially opens `~/Sync/Journal`. Use the folder button or **Cmd+K → Choose journal folder** to select another archive. It remembers that folder locally. The first Rust build takes a few minutes.

```sh
pnpm dev             # Browser preview with fictional sample entries
pnpm build           # Typecheck and build the frontend
pnpm tauri build     # Package the desktop application
pnpm icons:macos     # Regenerate padded macOS icons from public/leaflet.svg
pnpm test            # Entry parsing and search tests
pnpm test:e2e        # Browser interaction tests
pnpm format:check
cargo test --manifest-path src-tauri/Cargo.toml
```

Install the test browser once with `pnpm exec playwright install chromium`. Corepack uses the pnpm version pinned in `package.json`.

## Rebuild from the macOS app

Package this feature once with `pnpm tauri build --bundles app`, then open
`src-tauri/target/release/bundle/macos/Leaflet.app` or copy it into Applications.
An older installed version must be replaced once to gain the rebuild control.

Use **Leaflet → Rebuild app…**, the hammer icon at the bottom of the sidebar,
or **Cmd+K → Rebuild app**.
Choose the Leaflet workspace with the native folder picker, then
click **Rebuild & restart**. The folder is remembered by the native app. Rebuilds
only use this selection; a webview cannot submit a different build path. The build uses the current
checkout, including uncommitted changes; it does not pull, switch branches, or
install workspace dependencies. Only select a workspace whose build scripts you
trust. Keep the prerequisites above installed and run `pnpm install` after dependency
changes.

You can keep reading during the build. The dialog shows progress and the latest
build output; the full build/install log is saved as
`~/Library/Logs/app.leaflet.journal/local-rebuild.log`. On success, Leaflet stages
the new bundle beside the running app, ad-hoc signs and verifies it, quits,
replaces that app, and relaunches. No Apple developer certificate is needed.
Existing journal preferences and bookmarks remain in place. Build failures leave
the current app running; replacement or launch-command failures restore the
previous bundle when possible. Installer failures are reported once after relaunch;
old build logs do not put later launches into a failed state. The installer does not detect crashes after macOS
has accepted the launch request.

This is a local macOS developer workflow. It requires a writable app location and
is unavailable in browser previews, `pnpm desktop`, disk images, and translocated
apps. Builds reuse a separate Cargo cache under `src-tauri/target/local-rebuild`
and target the running app's architecture. Do not run the app directly from that
internal cache. Finder launches discover tools from the current user's login shell,
standard Cargo/Homebrew/pnpm locations, and nvm's selected/default Node version.
Corepack is used if a pnpm shim is unavailable. No build-machine PATH is embedded
in the app. If tools cannot be found, fix your login-shell environment first. No administrator prompt or remote release
service is used.

## Reading

- **Month browsing:** choose a year and month in the sidebar. The mini calendar jumps to a day; the list shows every entry, including multiple entries on the same date.
- **Paging:** Previous/Next or **Option+Left/Right** (Alt on Windows/Linux) moves between entries. At the end of a month, Next names the next available month and opens its first entry, skipping empty months. Next is disabled at the end of the archive. Previous stays within the current month; bookmarks and “On this day” stay within their collections.
- **Calendar:** a full year of days, with populated dates highlighted. Jump between years, months, and individual days.
- **Cmd+K / Ctrl+K:** search filenames, dates, titles, and body text. Enter opens the selected result; arrows move the selection; Escape closes. Prefix with `>` to filter quick commands.
- **Live updates:** new entries, edits, renames, and removals refresh automatically using native filesystem events. Bursts are grouped for half a second; a one-minute safety check and a check on returning to the app catch missed events. Your current entry, scroll position, view, and bookmarks stay in place. If native watching is unavailable, the sidebar shows the periodic refresh mode.
- **Rediscovery:** bookmarks, a random entry, and “On this day” across years.
- **Reading controls:** focus mode, light/dark themes, text size, and original-text view. Escape leaves focus mode. The last opened entry is remembered per archive.
- **Daily reflection:** “The 3 and 3” exercises become Gratitude, Forgiveness, and Curiosity cards, with every item retained. Skipped exercise banners are hidden in rendered mode and previews. Original-text mode always retains the complete source.
- **Light Markdown:** headings, emphasis, lists, links, quotes, code, and GFM tables. Original line breaks are retained. The original text is always accessible.

## Archive format

```text
Journal/
  2014-08-August/
    8.24.14.txt
    8.24.14.2.txt
    Notes.txt
  2026-10-October/
    10.01.26.txt
    10.02.26.txt
  template.txt                 # Not indexed
```

The loader reads `.txt` and `.md` files directly inside `YYYY-MM-Name` folders. It does not recurse through Pages bundles, follow directory/file symlinks, or read templates at the root. Filenames support `M.DD.YY`, `M.DD.YYYY`, and numbered parts. Dates must agree with their month folder. Named notes stay in that month's list without an invented day.

A leading weekday, optional `0–10/10` score, and equals-sign separator become display metadata. Unrecognized header text is preserved. Tabs used to indent old `.txt` prose are normalized only for rendered display. Original text is untouched.

Pages and Word documents are not imported; use plain-text or Markdown copies of those entries.

## Architecture and data

- `src-tauri/src/rebuild.rs` and `rebuild-install.sh`: local macOS builds, staged app replacement, relaunch, and rollback.
- `src-tauri/src/watch.rs`: native filesystem notifications with per-window subscription cleanup.
- `src/lib/archive-monitor.ts`: debounced, serialized background refresh, fallback checks, and cancellation when changing folders.
- `src-tauri/src/lib.rs`: asynchronous, read-only folder scan. Returns entries and per-file read warnings; no journal-writing command exists.
- `src/lib/journal.ts`: date/header parsing, ordering, metadata, and search.
- `src/lib/archive.ts`: native bridge, folder picker, and local preferences.
- `src/components/`: calendars and accessible native-dialog command palette.
- `src/App.tsx`: navigation and reader state.
- `src/lib/demo.ts`: fictional fixtures for browser preview and tests.

Journal contents stay in memory while the app is open. Only the folder path, bookmarked entry identifiers, last-opened entry, theme, and text size are saved in the webview's local storage. The native app saves the picker-selected build workspace in its app configuration directory. Rebuild commands are restricted to the main window by Tauri permissions and a native window check. No personal text is copied into the repository or bundled frontend. No accounts, telemetry, remote fonts, or network search are used. Raw HTML is not executed, images appear as placeholders, and supported links open in the system browser only after a click.

Use **Refresh journal** for an immediate manual reload; external changes are normally picked up automatically. Background checks compare snapshots and avoid re-rendering an unchanged archive. If the folder is temporarily unavailable, the last loaded entries remain readable while Leaflet retries. This scaffold loads the archive into memory and searches it locally; it does not yet include legacy document conversion, attachment rendering, editing, release signing, or remote automatic application updates. Browser tests cover the UI using fictional data; they do not substitute for testing native dialogs and macOS webview behavior.
