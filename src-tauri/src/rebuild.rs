//! Local developer updates. No network updater or privileged installer is involved.
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildStatus {
    phase: String,
    workspace: String,
    unavailable_reason: Option<String>,
    error: Option<String>,
    log: String,
    log_path: Option<String>,
}

pub struct RebuildState(Arc<Mutex<RebuildStatus>>);
impl Default for RebuildState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(RebuildStatus {
            phase: "idle".into(),
            workspace: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            unavailable_reason: unavailable_reason(),
            error: None,
            log: String::new(),
            log_path: None,
        })))
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

#[tauri::command]
pub fn rebuild_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, RebuildState>,
) -> RebuildStatus {
    let mut status = state.0.lock().unwrap().clone();
    if status.log_path.is_none() {
        status.log_path = app
            .path()
            .app_log_dir()
            .ok()
            .map(|p| p.join("local-rebuild.log"))
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned());
    }
    if let Some(path) = &status.log_path {
        // Read only a bounded tail, even during a very verbose build.
        use std::io::{Read, Seek, SeekFrom};
        if let Ok(mut file) = std::fs::File::open(path) {
            let size = file.metadata().map(|m| m.len()).unwrap_or(0);
            let _ = file.seek(SeekFrom::Start(size.saturating_sub(16_384)));
            let mut bytes = Vec::new();
            let _ = file.take(16_384).read_to_end(&mut bytes);
            status.log = String::from_utf8_lossy(&bytes).into_owned();
        }
    }
    if status.phase == "idle" {
        if let Some(error) = status
            .log
            .lines()
            .rev()
            .find(|line| line.starts_with("Update failed:"))
        {
            status.error = Some(error.to_owned());
            status.phase = "failed".into();
        }
    }
    status
}

#[tauri::command]
pub fn rebuild_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, RebuildState>,
    workspace: String,
) -> Result<(), String> {
    if let Some(reason) = unavailable_reason() {
        return Err(reason);
    }
    {
        let mut status = state.0.lock().unwrap();
        if matches!(status.phase.as_str(), "building" | "installing") {
            return Err("A rebuild is already running.".into());
        }
        status.phase = "building".into();
        status.workspace = workspace.clone();
        status.error = None;
        status.log.clear();
        status.log_path = None;
    }
    #[cfg(target_os = "macos")]
    {
        let state = state.0.clone();
        std::thread::spawn(move || {
            if let Err(error) = macos::build_and_restart(&app, &state, &workspace) {
                let mut status = state.lock().unwrap();
                if let Some(path) = &status.log_path {
                    use std::io::Write;
                    if let Ok(mut log) = std::fs::OpenOptions::new().append(true).open(path) {
                        let _ = writeln!(log, "Update failed: {error}");
                    }
                }
                status.phase = "failed".into();
                status.error = Some(error);
            }
        });
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

    fn validate_workspace(workspace: &str) -> Result<PathBuf, String> {
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
            .unwrap()
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
            let mut status = state.lock().unwrap();
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
            .args(["-lc", "export PATH=\"$LEAFLET_BUILD_PATH:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; cd -- \"$LEAFLET_WORKSPACE\" || exit 1; exec pnpm exec tauri build --bundles app --target \"$LEAFLET_BUILD_TARGET\""])
            .current_dir(root)
            .env("LEAFLET_BUILD_PATH", env!("LEAFLET_BUILD_PATH"))
            .env("LEAFLET_WORKSPACE", root)
            .env("LEAFLET_BUILD_TARGET", triple)
            .env("CARGO_TARGET_DIR", &target)
            .env("CI", "true")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log.try_clone().map_err(|e| e.to_string())?)
            .status().map_err(|e| format!("Could not start the build: {e}"))?;
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
                state.lock().unwrap().phase = "installing".into();
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
            let root = std::env::temp_dir().join(format!("leaflet install ' $ {nonce}"));
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
[ "$FAILURE" != launch ] || [ "$version" != new ]
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
                    "launch" => "new\nold\n",
                    "install" => "old\n",
                    _ => "new\n",
                }
            );
            if failure.is_empty() {
                assert!(!staging.exists());
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
