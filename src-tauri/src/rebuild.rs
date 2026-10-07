//! Local developer updates. No network updater or privileged installer is involved.
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};
use tauri::Manager;

const INSTALL_ERROR: &str = "local-rebuild-install-error";
const WORKSPACE_PREFERENCE: &str = "local-rebuild-workspace.json";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildStatus {
    phase: String,
    workspace: String,
    unavailable_reason: Option<String>,
    error: Option<String>,
    log: String,
    log_path: Option<String>,
    #[serde(skip)]
    initialized: bool,
}

pub struct RebuildState(Arc<Mutex<RebuildStatus>>);
impl Default for RebuildState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(RebuildStatus {
            phase: "idle".into(),
            workspace: String::new(),
            unavailable_reason: unavailable_reason(),
            error: None,
            log: String::new(),
            log_path: None,
            initialized: false,
        })))
    }
}

fn lock_status(state: &Mutex<RebuildStatus>) -> MutexGuard<'_, RebuildStatus> {
    // A worker panic must not make either status reads or retries panic too.
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn require_main(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("Local rebuild commands are only available in the main window.".into())
    }
}

fn unavailable_reason() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        macos::installed_bundle().err()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some("Local app rebuilding is available on macOS.".into())
    }
}

fn initialize(status: &mut RebuildStatus, config: &Path, logs: &Path) {
    if !status.initialized {
        status.workspace = fs::read(config.join(WORKSPACE_PREFERENCE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<String>(&bytes).ok())
            .unwrap_or_default();
        let log = logs.join("local-rebuild.log");
        if log.is_file() {
            status.log_path = Some(log.to_string_lossy().into_owned());
        }
        status.initialized = true;
    }
    // Only the detached installer writes this marker. Keep the error for this
    // session, but consume it so future launches do not resurrect old failures.
    if let Some(error) = consume_install_error(&logs.join(INSTALL_ERROR)) {
        status.error = Some(error);
        status.phase = "failed".into();
    }
}

fn consume_install_error(path: &Path) -> Option<String> {
    let message = fs::read_to_string(path).ok()?;
    fs::remove_file(path).ok()?;
    Some(message.trim().to_owned())
}

fn status_snapshot(state: &Mutex<RebuildStatus>) -> RebuildStatus {
    let mut status = lock_status(state).clone();
    // Never fall back to the previous run's log while a new worker is starting.
    if let Some(path) = &status.log_path {
        use std::io::{Read, Seek, SeekFrom};
        if let Ok(mut file) = fs::File::open(path) {
            let size = file.metadata().map(|m| m.len()).unwrap_or(0);
            let _ = file.seek(SeekFrom::Start(size.saturating_sub(16_384)));
            let mut bytes = Vec::new();
            let _ = file.take(16_384).read_to_end(&mut bytes);
            status.log = String::from_utf8_lossy(&bytes).into_owned();
        }
    }
    status
}

#[tauri::command]
pub fn rebuild_status(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, RebuildState>,
) -> Result<RebuildStatus, String> {
    require_main(window.label())?;
    initialize(
        &mut lock_status(&state.0),
        &app.path().app_config_dir().map_err(|e| e.to_string())?,
        &app.path().app_log_dir().map_err(|e| e.to_string())?,
    );
    Ok(status_snapshot(&state.0))
}

#[tauri::command]
pub async fn choose_build_workspace(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, RebuildState>,
) -> Result<Option<String>, String> {
    require_main(window.label())?;
    ensure_idle(&lock_status(&state.0))?;
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_dialog::DialogExt;
        let picker_app = app.clone();
        let selected = tauri::async_runtime::spawn_blocking(move || {
            picker_app
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("Choose the Leaflet workspace")
                .blocking_pick_folder()
        })
        .await
        .map_err(|e| e.to_string())?;
        let Some(selected) = selected else {
            return Ok(None);
        };
        let selected = selected.into_path().map_err(|e| e.to_string())?;
        let root = macos::validate_workspace(&selected.to_string_lossy())?;
        let workspace = root.to_string_lossy().into_owned();
        let mut status = lock_status(&state.0);
        ensure_idle(&status)?;
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
        initialize(&mut status, &config, &logs);
        fs::create_dir_all(&config).map_err(|e| e.to_string())?;
        let temporary = config.join("local-rebuild-workspace.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec(&workspace).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(temporary, config.join(WORKSPACE_PREFERENCE)).map_err(|e| e.to_string())?;
        status.workspace = workspace.clone();
        Ok(Some(workspace))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Local app rebuilding is available on macOS.".into())
    }
}

fn ensure_idle(status: &RebuildStatus) -> Result<(), String> {
    if matches!(status.phase.as_str(), "building" | "installing") {
        Err("A rebuild is already running.".into())
    } else {
        Ok(())
    }
}

fn begin_rebuild(status: &mut RebuildStatus) -> Result<String, String> {
    ensure_idle(status)?;
    if status.workspace.is_empty() {
        return Err(
            "Choose the Leaflet workspace with the folder picker before rebuilding.".into(),
        );
    }
    status.phase = "building".into();
    status.error = None;
    status.log.clear();
    status.log_path = None;
    Ok(status.workspace.clone())
}

fn fail_worker(state: &Mutex<RebuildStatus>, error: String) {
    let mut status = lock_status(state);
    if let Some(path) = &status.log_path {
        use std::io::Write;
        if let Ok(mut log) = fs::OpenOptions::new().append(true).open(path) {
            let _ = writeln!(log, "Update failed: {error}");
        }
    }
    status.phase = "failed".into();
    status.error = Some(error);
}

fn run_worker(state: &Mutex<RebuildStatus>, job: impl FnOnce() -> Result<(), String>) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job)).unwrap_or_else(|_| {
        Err("The rebuild worker stopped unexpectedly. You can retry; see the build output.".into())
    });
    if let Err(error) = result {
        fail_worker(state, error);
    }
}

#[tauri::command]
pub fn rebuild_app(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, RebuildState>,
) -> Result<(), String> {
    require_main(window.label())?;
    if let Some(reason) = unavailable_reason() {
        return Err(reason);
    }
    let workspace = {
        let mut status = lock_status(&state.0);
        initialize(
            &mut status,
            &app.path().app_config_dir().map_err(|e| e.to_string())?,
            &app.path().app_log_dir().map_err(|e| e.to_string())?,
        );
        begin_rebuild(&mut status)?
    };
    #[cfg(target_os = "macos")]
    {
        let worker_state = state.0.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("local-rebuild".into())
            .spawn(move || {
                run_worker(&worker_state, || {
                    macos::build_and_restart(&app, &worker_state, &workspace)
                });
            })
        {
            let error = format!("Could not start the rebuild worker: {error}");
            fail_worker(&state.0, error.clone());
            return Err(error);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, workspace);
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::{
        fs,
        io::Write,
        path::Path,
        process::{Command, Stdio},
        time::{SystemTime, UNIX_EPOCH},
    };

    const IDENTIFIER: &str = "app.leaflet.journal";
    const INSTALLER: &str = include_str!("rebuild-install.sh");

    pub(super) fn installed_bundle() -> Result<PathBuf, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let macos = exe.parent().ok_or("Cannot locate the running app.")?;
        let contents = macos.parent().ok_or("Cannot locate the running app.")?;
        let bundle = contents.parent().ok_or("Cannot locate the running app.")?;
        if macos.file_name().is_none_or(|name| name != "MacOS")
            || contents.file_name().is_none_or(|name| name != "Contents")
            || bundle.extension().is_none_or(|ext| ext != "app")
        {
            return Err("Open an installed Leaflet.app to rebuild it. During pnpm desktop, source changes reload automatically.".into());
        }
        if bundle.starts_with("/Volumes") || bundle.to_string_lossy().contains("/AppTranslocation/")
        {
            return Err("Move Leaflet to Applications (or another writable folder), then reopen it before rebuilding.".into());
        }
        Ok(bundle.to_path_buf())
    }

    pub(super) fn validate_workspace(workspace: &str) -> Result<PathBuf, String> {
        let root = Path::new(workspace)
            .canonicalize()
            .map_err(|e| format!("Cannot open the workspace: {e}"))?;
        let config: serde_json::Value = serde_json::from_slice(
            &fs::read(root.join("src-tauri/tauri.conf.json"))
                .map_err(|_| "Choose the Leaflet workspace containing package.json and src-tauri/tauri.conf.json.")?
        ).map_err(|e| format!("Invalid Tauri configuration: {e}"))?;
        if config["identifier"] != IDENTIFIER
            || !root.join("package.json").is_file()
            || !root.join("src-tauri/Cargo.toml").is_file()
        {
            return Err("This folder is not a Leaflet workspace.".into());
        }
        Ok(root)
    }

    fn validate_bundle(bundle: &Path) -> Result<(), String> {
        let plist = bundle.join("Contents/Info.plist");
        let read = |key: &str| -> Result<String, String> {
            let result = Command::new("/usr/libexec/PlistBuddy")
                .args(["-c", &format!("Print :{key}")])
                .arg(&plist)
                .output()
                .map_err(|e| e.to_string())?;
            if !result.status.success() {
                return Err("The rebuilt app has an invalid Info.plist.".into());
            }
            Ok(String::from_utf8_lossy(&result.stdout).trim().to_owned())
        };
        if read("CFBundleIdentifier")? != IDENTIFIER {
            return Err(
                "The rebuilt app has a different bundle identifier; the current app was kept."
                    .into(),
            );
        }
        let executable = read("CFBundleExecutable")?;
        if executable.contains('/')
            || executable.is_empty()
            || !bundle.join("Contents/MacOS").join(executable).is_file()
        {
            return Err("The rebuilt app is missing its executable.".into());
        }
        Ok(())
    }

    pub(super) fn build_and_restart(
        app: &tauri::AppHandle,
        state: &Arc<Mutex<RebuildStatus>>,
        workspace: &str,
    ) -> Result<(), String> {
        let root = validate_workspace(workspace)?;
        let destination = installed_bundle()?;
        validate_bundle(&destination)?;
        let parent = destination
            .parent()
            .ok_or("Cannot locate the app's folder.")?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let staging = parent.join(format!(".leaflet-rebuild-{}-{nonce}", std::process::id()));
        // Stage on the destination volume so replacement uses renames, never a partial copy.
        fs::create_dir(&staging).map_err(|e| {
            format!(
                "Cannot update this app in {}: {e}. Move it to a writable folder and reopen it.",
                parent.display()
            )
        })?;
        let result = prepare_update(app, state, &root, &destination, &staging);
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }

    fn prepare_update(
        app: &tauri::AppHandle,
        state: &Arc<Mutex<RebuildStatus>>,
        root: &Path,
        destination: &Path,
        staging: &Path,
    ) -> Result<(), String> {
        let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
        let log_path = logs.join("local-rebuild.log");
        let mut log = fs::File::create(&log_path).map_err(|e| e.to_string())?;
        writeln!(
            log,
            "Building workspace: {}\nUpdating app: {}",
            root.display(),
            destination.display()
        )
        .map_err(|e| e.to_string())?;
        {
            let mut status = lock_status(state);
            status.log_path = Some(log_path.to_string_lossy().into_owned());
            status.workspace = root.to_string_lossy().into_owned();
        }
        // Keep Cargo away from the running bundle, including when opened from target/release.
        let target = root.join("src-tauri/target/local-rebuild");
        // A previous successful bundle must never be mistaken for this build's output.
        let triple = if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        };
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        if destination
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(target.canonicalize().map_err(|e| e.to_string())?)
        {
            return Err("Move this build to Applications (or another folder outside target/local-rebuild) and reopen it before rebuilding.".into());
        }
        let bundles = target.join(triple).join("release/bundle/macos");
        if bundles.exists() {
            fs::remove_dir_all(&bundles).map_err(|e| e.to_string())?;
        }
        let output = Command::new("/bin/zsh")
            .args(["-lc", include_str!("rebuild-build.sh")])
            .current_dir(root)
            .env("LEAFLET_WORKSPACE", root)
            .env("LEAFLET_BUILD_TARGET", triple)
            .env("CARGO_TARGET_DIR", &target)
            .env("CI", "true")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log.try_clone().map_err(|e| e.to_string())?)
            .status()
            .map_err(|e| format!("Could not start the build: {e}"))?;
        if !output.success() {
            return Err("Build failed. The current app is unchanged. Check the build output; Node.js, pnpm, Rust, Xcode command-line tools, and installed workspace dependencies are required.".into());
        }
        let candidates: Vec<_> = fs::read_dir(&bundles)
            .map_err(|e| format!("Cannot find the rebuilt app: {e}"))?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .collect();
        if candidates.len() != 1 {
            return Err("Expected exactly one rebuilt app bundle.".into());
        }
        validate_bundle(&candidates[0])?;
        let staged = staging.join("new.app");
        let copied = Command::new("/usr/bin/ditto")
            .arg(&candidates[0])
            .arg(&staged)
            .stderr(log.try_clone().map_err(|e| e.to_string())?)
            .status()
            .map_err(|e| e.to_string())?;
        if !copied.success() {
            return Err("Could not stage the rebuilt app. The current app is unchanged.".into());
        }
        validate_bundle(&staged)?;
        // Local Tauri bundles can retain only the linker's executable signature.
        // Seal the complete staged bundle before handing it to LaunchServices.
        for args in [
            vec![
                "--force",
                "--deep",
                "--sign",
                "-",
                "--preserve-metadata=entitlements,flags,runtime",
            ],
            vec!["--verify", "--deep", "--strict"],
        ] {
            let signed = Command::new("/usr/bin/codesign")
                .args(args)
                .arg(&staged)
                .stdout(log.try_clone().map_err(|e| e.to_string())?)
                .stderr(log.try_clone().map_err(|e| e.to_string())?)
                .status()
                .map_err(|e| e.to_string())?;
            if !signed.success() {
                return Err("Could not sign or verify the local build. The current app is unchanged; see the build output.".into());
            }
        }
        let script = staging.join("install.sh");
        fs::write(&script, INSTALLER).map_err(|e| e.to_string())?;
        let ready = staging.join("ready");
        let mut helper = Command::new("/bin/sh");
        helper
            .arg(&script)
            .arg(std::process::id().to_string())
            .arg(destination)
            .arg(staging)
            .arg(logs.join(INSTALL_ERROR))
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        use std::os::unix::process::CommandExt;
        helper.process_group(0);
        let mut child = helper
            .spawn()
            .map_err(|e| format!("Could not start the installer: {e}"))?;
        for _ in 0..50 {
            if ready.exists() {
                lock_status(state).phase = "installing".into();
                app.exit(0);
                return Ok(());
            }
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("Installer could not start. The current app is unchanged.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
        Err("Installer did not become ready. The current app is unchanged.".into())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        // Exercise the actual detached installer with fake app contents and a fake
        // LaunchServices command. Never replace or launch the user's installed app.
        fn install_fixture(failure: &str) {
            use std::os::unix::fs::PermissionsExt;
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "leaflet install ' $ {}-{failure}-{nonce}",
                std::process::id()
            ));
            let staging = root.join("staging");
            let destination = root.join("Leaflet test.app");
            let bin = root.join("bin");
            fs::create_dir_all(staging.join("new.app")).unwrap();
            fs::create_dir_all(&destination).unwrap();
            fs::create_dir_all(&bin).unwrap();
            fs::write(destination.join("version"), "old").unwrap();
            fs::write(staging.join("new.app/version"), "new").unwrap();
            fs::write(
                bin.join("open"),
                r#"#!/bin/sh
version=$(cat "$2/version")
echo "$version" >> "$TEST_ROOT/launches"
case "$FAILURE" in launch|marker) [ "$version" != new ];; *) exit 0;; esac
"#,
            )
            .unwrap();
            fs::write(
                bin.join("mv"),
                r#"#!/bin/sh
if [ "$FAILURE" = install ] && [ "$1" = "$TEST_ROOT/staging/new.app" ]; then exit 1; fi
exec /bin/mv "$@"
"#,
            )
            .unwrap();
            for name in ["open", "mv"] {
                fs::set_permissions(bin.join(name), fs::Permissions::from_mode(0o755)).unwrap();
            }
            let script = root.join("install.sh");
            fs::write(&script, INSTALLER).unwrap();
            let mut exited = Command::new("/usr/bin/true").spawn().unwrap();
            let pid = exited.id();
            exited.wait().unwrap();
            let output = Command::new("/bin/sh")
                .arg(script)
                .arg(pid.to_string())
                .arg(&destination)
                .arg(&staging)
                .arg(root.join(if failure == "marker" {
                    "missing/error"
                } else {
                    INSTALL_ERROR
                }))
                .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
                .env("TEST_ROOT", &root)
                .env("FAILURE", failure)
                .output()
                .unwrap();
            assert_eq!(
                output.status.success(),
                failure.is_empty(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let version = fs::read_to_string(destination.join("version")).unwrap();
            assert_eq!(version, if failure.is_empty() { "new" } else { "old" });
            let launches = fs::read_to_string(root.join("launches")).unwrap();
            assert_eq!(
                launches,
                match failure {
                    "launch" | "marker" => "new\nold\n",
                    "install" => "old\n",
                    _ => "new\n",
                }
            );
            if failure.is_empty() {
                assert!(!staging.exists());
                assert!(!root.join(INSTALL_ERROR).exists());
            } else if failure != "marker" {
                let error = consume_install_error(&root.join(INSTALL_ERROR)).unwrap();
                assert!(error.contains(if failure == "launch" {
                    "launch"
                } else {
                    "install"
                }));
                assert!(consume_install_error(&root.join(INSTALL_ERROR)).is_none());
            }
            fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn installer_replaces_and_relaunches_with_quoted_paths() {
            install_fixture("");
        }
        #[test]
        fn installer_restores_previous_app_when_install_fails() {
            install_fixture("install");
        }
        #[test]
        fn installer_restores_previous_app_when_launch_fails() {
            install_fixture("launch");
        }

        #[test]
        fn installer_still_rolls_back_if_error_reporting_fails() {
            install_fixture("marker");
        }
        #[test]
        fn rejects_unrelated_workspaces() {
            assert!(validate_workspace("/tmp").is_err());
            assert!(validate_workspace("/nonexistent/leaflet").is_err());
            assert!(validate_workspace(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .to_str()
                    .unwrap()
            )
            .is_ok());
        }
    }
}

#[cfg(test)]
mod state_tests {
    use super::*;

    fn scratch() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "leaflet-rebuild-state-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn installer_error_is_consumed_for_one_session_and_logs_never_set_phase() {
        let root = scratch();
        fs::write(
            root.join("local-rebuild.log"),
            "Update failed: old build error\n",
        )
        .unwrap();
        let first = RebuildState::default();
        initialize(&mut lock_status(&first.0), &root, &root);
        assert_eq!(status_snapshot(&first.0).phase, "idle");
        assert!(status_snapshot(&first.0).error.is_none());
        fs::write(root.join(INSTALL_ERROR), "Could not install the build.\n").unwrap();
        initialize(&mut lock_status(&first.0), &root, &root);
        assert_eq!(status_snapshot(&first.0).phase, "failed");
        assert_eq!(
            status_snapshot(&first.0).error.as_deref(),
            Some("Could not install the build.")
        );
        assert!(!root.join(INSTALL_ERROR).exists());
        initialize(&mut lock_status(&first.0), &root, &root);
        assert_eq!(status_snapshot(&first.0).phase, "failed");
        let next_launch = RebuildState::default();
        initialize(&mut lock_status(&next_launch.0), &root, &root);
        assert_eq!(status_snapshot(&next_launch.0).phase, "idle");
        assert!(status_snapshot(&next_launch.0).error.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn new_worker_cannot_show_previous_log_or_start_twice() {
        let root = scratch();
        fs::write(root.join("local-rebuild.log"), "Previous build output").unwrap();
        fs::write(
            root.join(WORKSPACE_PREFERENCE),
            r#""/native/picker/workspace""#,
        )
        .unwrap();
        let state = RebuildState::default();
        initialize(&mut lock_status(&state.0), &root, &root);
        assert_eq!(
            begin_rebuild(&mut lock_status(&state.0)).unwrap(),
            "/native/picker/workspace"
        );
        // A status poll during worker startup must not reattach the old log.
        initialize(&mut lock_status(&state.0), &root, &root);
        let snapshot = status_snapshot(&state.0);
        assert_eq!(snapshot.phase, "building");
        assert!(snapshot.log.is_empty());
        assert!(snapshot.log_path.is_none());
        assert!(begin_rebuild(&mut lock_status(&state.0)).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn panic_with_poisoned_mutex_recovers_to_a_retryable_failure() {
        let state = RebuildState::default();
        lock_status(&state.0).workspace = "/native/picker/workspace".into();
        begin_rebuild(&mut lock_status(&state.0)).unwrap();
        run_worker(&state.0, || {
            let _guard = state.0.lock().unwrap();
            panic!("injected worker panic");
        });
        assert!(state.0.is_poisoned());
        let status = status_snapshot(&state.0);
        assert_eq!(status.phase, "failed");
        assert!(status.error.unwrap().contains("stopped unexpectedly"));
        assert!(begin_rebuild(&mut lock_status(&state.0)).is_ok());
    }

    #[test]
    fn rebuild_requires_native_selection_and_main_window() {
        let state = RebuildState::default();
        assert!(begin_rebuild(&mut lock_status(&state.0)).is_err());
        assert!(require_main("main").is_ok());
        assert!(require_main("secondary").is_err());
        assert!(require_main("").is_err());
    }
}
