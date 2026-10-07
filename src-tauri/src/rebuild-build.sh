# Executed by a login zsh; discover this user's tools at runtime, not build time.
export PATH="$HOME/.cargo/bin:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"
# nvm is often initialized only in interactive shells. Load its selected/default
# version when Finder's environment cannot find Node or pnpm.
if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
fi
cd -- "$LEAFLET_WORKSPACE" || exit 1
if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    exec corepack pnpm exec tauri build --bundles app --target "$LEAFLET_BUILD_TARGET"
fi
exec pnpm exec tauri build --bundles app --target "$LEAFLET_BUILD_TARGET"
