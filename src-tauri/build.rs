fn main() {
    // Finder-launched apps do not inherit the terminal's Node/pnpm toolchain.
    println!("cargo:rerun-if-env-changed=PATH");
    println!(
        "cargo:rustc-env=LEAFLET_BUILD_PATH={}",
        std::env::var("PATH").unwrap_or_default()
    );
    tauri_build::build()
}
