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

## Reading

- **Month browsing:** choose a year and month in the sidebar. The mini calendar jumps to a day; the list shows every entry, including multiple entries on the same date.
- **Paging:** Previous/Next or **Option+Left/Right** (Alt on Windows/Linux) moves between entries. At the end of a month, Next names the next available month and opens its first entry, skipping empty months. Next is disabled at the end of the archive. Previous stays within the current month; bookmarks and “On this day” stay within their collections.
- **Calendar:** a full year of days, with populated dates highlighted. Jump between years, months, and individual days.
- **Cmd+K / Ctrl+K:** search filenames, dates, titles, and body text. Enter opens the selected result; arrows move the selection; Escape closes. Prefix with `>` to filter quick commands.
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

- `src-tauri/src/lib.rs`: asynchronous, read-only folder scan. Returns entries and per-file read warnings; no journal-writing command exists.
- `src/lib/journal.ts`: date/header parsing, ordering, metadata, and search.
- `src/lib/archive.ts`: native bridge, folder picker, and local preferences.
- `src/components/`: calendars and accessible native-dialog command palette.
- `src/App.tsx`: navigation and reader state.
- `src/lib/demo.ts`: fictional fixtures for browser preview and tests.

Journal contents stay in memory while the app is open. Only the folder path, bookmarked entry identifiers, last-opened entry, theme, and text size are saved in the webview's local storage. No personal text is copied into the repository or bundled frontend. No accounts, telemetry, remote fonts, or network search are used. Raw HTML is not executed, images appear as placeholders, and supported links open in the system browser only after a click.

Use **Refresh journal** after changing files externally. This scaffold loads the archive into memory and searches it locally; it does not yet include live file watching, legacy document conversion, attachment rendering, editing, signing, or automatic updates. Browser tests cover the UI using fictional data; they do not substitute for testing native dialogs and macOS webview behavior.
