mod rebuild;
mod watch;

use serde::Serialize;
use std::{fs, path::PathBuf};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct Entry {
    path: String,
    name: String,
    month: String,
    content: String,
}
#[derive(Serialize)]
struct Archive {
    root: String,
    entries: Vec<Entry>,
    warnings: Vec<String>,
}

fn month_key(name: &str) -> Option<String> {
    let bytes = name.as_bytes();
    if bytes.len() < 8
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    let month: u8 = name[5..7].parse().ok()?;
    (1..=12).contains(&month).then(|| name[..7].to_owned())
}

fn scan_archive(root: PathBuf) -> Result<Archive, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot open journal folder: {e}"))?;
    let mut archive = Archive {
        root: root.to_string_lossy().into_owned(),
        entries: vec![],
        warnings: vec![],
    };
    for item in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let folder = item.map_err(|e| e.to_string())?;
        if !folder.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let folder_name = folder.file_name().to_string_lossy().into_owned();
        let Some(month) = month_key(&folder_name) else {
            continue;
        };
        let files = match fs::read_dir(folder.path()) {
            Ok(files) => files,
            Err(e) => {
                archive.warnings.push(format!("{folder_name}: {e}"));
                continue;
            }
        };
        for file in files {
            let file = match file {
                Ok(file) => file,
                Err(e) => {
                    archive.warnings.push(e.to_string());
                    continue;
                }
            };
            // Do not descend into old Pages bundles or follow symlinks.
            if !file.file_type().map_err(|e| e.to_string())?.is_file() {
                continue;
            }
            let path = file.path();
            if !matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("txt" | "md")
            ) {
                continue;
            }
            let name = file.file_name().to_string_lossy().into_owned();
            match fs::read_to_string(&path) {
                Ok(content) => archive.entries.push(Entry {
                    path: format!("{folder_name}/{name}"),
                    name,
                    month: month.clone(),
                    content,
                }),
                Err(e) => archive.warnings.push(format!("{folder_name}/{name}: {e}")),
            }
        }
    }
    archive.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(archive)
}

#[tauri::command]
async fn load_archive(app: tauri::AppHandle, root: Option<String>) -> Result<Archive, String> {
    let path = match root {
        Some(root) => PathBuf::from(root),
        None => app
            .path()
            .home_dir()
            .map_err(|e| e.to_string())?
            .join("Sync/Journal"),
    };
    tauri::async_runtime::spawn_blocking(move || scan_archive(path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(watch::JournalWatchers::default())
        .manage(rebuild::RebuildState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let menu = Menu::default(app.handle())?;
                let mut added_rebuild_item = false;
                for item in menu.items()? {
                    if let Some(submenu) = item.as_submenu() {
                        if submenu.text()? == app.package_info().name {
                            let rebuild = MenuItem::with_id(
                                app,
                                "rebuild",
                                "Rebuild app…",
                                true,
                                None::<&str>,
                            )?;
                            // The default Leaflet menu starts with About and a separator.
                            submenu.insert_items(
                                &[&rebuild, &PredefinedMenuItem::separator(app)?],
                                2,
                            )?;
                            added_rebuild_item = true;
                            break;
                        }
                    }
                }
                if !added_rebuild_item {
                    eprintln!("Could not add Rebuild app to the Leaflet menu: submenu not found");
                }
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "rebuild" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                    let _ = window.emit("open-rebuild", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_archive,
            watch::watch_archive,
            watch::unwatch_archive,
            rebuild::rebuild_status,
            rebuild::rebuild_app,
            rebuild::choose_build_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running Leaflet");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires an explicit local archive path; never used by CI"]
    fn scans_local_archive() {
        let root = std::env::var("LEAFLET_TEST_JOURNAL").expect("Set LEAFLET_TEST_JOURNAL");
        let archive = scan_archive(PathBuf::from(root)).unwrap();
        assert!(!archive.entries.is_empty());
        assert!(
            archive.warnings.is_empty(),
            "Some entries could not be read"
        );
        println!(
            "Read {} entries without modifying source files",
            archive.entries.len()
        );
    }

    #[test]
    fn recognizes_only_month_folders() {
        assert_eq!(month_key("2026-10-October"), Some("2026-10".into()));
        for name in [
            "template.txt",
            "2026-13-Invalid",
            "2026-00-Invalid",
            "éééé-10-x",
            "2026-1-x",
        ] {
            assert_eq!(month_key(name), None);
        }
    }
    #[test]
    fn reads_text_and_markdown_without_recursing_into_packages() {
        let root = std::env::temp_dir().join(format!("leaflet-test-{}", std::process::id()));
        let month = root.join("2026-10-October");
        fs::create_dir_all(month.join("old.pages")).unwrap();
        fs::write(month.join("10.01.26.txt"), "Hello").unwrap();
        fs::write(month.join("Goals.md"), "# Goals").unwrap();
        fs::write(month.join("old.pages/hidden.txt"), "Ignore").unwrap();
        fs::write(root.join("template.txt"), "Ignore").unwrap();
        let archive = scan_archive(root.clone()).unwrap();
        assert_eq!(archive.entries.len(), 2);
        assert!(archive.warnings.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
