use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::Emitter;

#[derive(Default)]
pub struct JournalWatchers {
    next_id: AtomicU64,
    active: Mutex<HashMap<String, (u64, RecommendedWatcher)>>,
}

#[derive(Clone, Serialize)]
struct JournalChange {
    root: String,
    failed: bool,
}

fn relevant_change(root: &Path, event: &Event) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    if event.need_rescan() || event.paths.is_empty() {
        return true;
    }
    event.paths.iter().any(|path| {
        let Ok(relative) = path.strip_prefix(root) else {
            return false;
        };
        let parts: Vec<_> = relative.components().collect();
        if parts.is_empty() {
            return true;
        }
        let folder = parts[0].as_os_str().to_string_lossy();
        if super::month_key(&folder).is_none() {
            return false;
        }
        match parts.len() {
            1 => true, // A new, moved, or removed month folder.
            2 => matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("txt" | "md")
            ),
            _ => false, // Ignore Pages bundles and attachments.
        }
    })
}

fn watch_path(
    root: &Path,
    handler: impl notify::EventHandler,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = RecommendedWatcher::new(
        handler,
        notify::Config::default().with_follow_symlinks(false),
    )?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[tauri::command]
pub fn watch_archive(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, JournalWatchers>,
    root: String,
) -> Result<u64, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Journal folder is not a directory".into());
    }
    let observed = root.clone();
    let watcher = watch_path(&root, move |result: notify::Result<Event>| {
        let failed = match result {
            Ok(event) if relevant_change(&observed, &event) => false,
            Ok(_) => return,
            Err(_) => true,
        };
        let _ = app.emit(
            "journal-changed",
            JournalChange {
                root: observed.to_string_lossy().into_owned(),
                failed,
            },
        );
    })
    .map_err(|e| e.to_string())?;
    // Replacing the window's subscription also releases watchers left by a webview reload.
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    if active
        .get(window.label())
        .is_none_or(|(current, _)| *current < id)
    {
        active.insert(window.label().to_owned(), (id, watcher));
    }
    Ok(id)
}

#[tauri::command]
pub fn unwatch_archive(state: tauri::State<'_, JournalWatchers>, id: u64) -> Result<(), String> {
    // Each subscription owns its handle; late cleanup cannot stop a newer watcher.
    state
        .active
        .lock()
        .map_err(|e| e.to_string())?
        .retain(|_, (current, _)| *current != id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, ModifyKind, RenameMode};
    use std::{
        fs,
        sync::mpsc,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn filters_reads_and_unrelated_files_but_accepts_new_months_and_renames() {
        let root = Path::new("/journal");
        let event =
            |path: &str| Event::new(EventKind::Create(CreateKind::Any)).add_path(root.join(path));
        assert!(relevant_change(
            root,
            &event("2026-10-October/10.03.26.txt")
        ));
        assert!(relevant_change(root, &event("2026-11-November")));
        assert!(!relevant_change(root, &event("template.txt")));
        assert!(!relevant_change(root, &event("2026-10-October/.DS_Store")));
        assert!(!relevant_change(
            root,
            &event("2026-10-October/old.pages/hidden.txt")
        ));
        assert!(!relevant_change(
            root,
            &Event::new(EventKind::Access(AccessKind::Read))
                .add_path(root.join("2026-10-October/10.03.26.txt"))
        ));
        let renamed = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(root.join("2026-10-October/temp"))
            .add_path(root.join("2026-10-October/10.03.26.txt"));
        assert!(relevant_change(root, &renamed));
    }

    #[test]
    fn native_watcher_observes_an_entry_in_a_new_month() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("leaflet-watch-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let (send, receive) = mpsc::channel();
        let watcher = watch_path(&root, move |result| {
            let _ = send.send(result);
        })
        .unwrap();
        let month = root.join("2026-11-November");
        fs::create_dir(&month).unwrap();
        fs::write(month.join("11.01.26.txt"), "A new month.").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut observed = false;
        while let Ok(result) =
            receive.recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            if let Ok(event) = result {
                if relevant_change(&root, &event) {
                    observed = true;
                    break;
                }
            }
            if Instant::now() >= deadline {
                break;
            }
        }
        drop(watcher);
        fs::remove_dir_all(root).unwrap();
        assert!(
            observed,
            "No filesystem notification for the newly created entry"
        );
    }
}
