# Executed by a login zsh; discover this user's tools at runtime, not build time.
export PATH="$HOME/.cargo/bin:${PNPM_HOME:-$HOME/Library/pnpm}:$HOME/Library/pnpm/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# nvm is often initialized only in interactive shells. Load its selected/default
# version when Finder's environment cannot find Node or pnpm.
if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
fi
cd -- "$LEAFLET_WORKSPACE" || exit 1
if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    # Tauri's beforeBuildCommand runs `pnpm build` in a child shell. Calling
    # `corepack pnpm` only here does not make pnpm available to that shell.
    # Create shims for this build without modifying the user's Node install.
    leaflet_tools=$(mktemp -d "${TMPDIR:-/tmp}/leaflet-rebuild-tools.XXXXXX") || exit 1
    trap 'rm -rf -- "$leaflet_tools"' EXIT
    corepack enable --install-directory "$leaflet_tools" pnpm || exit $?
    export PATH="$leaflet_tools:$PATH"
    pnpm exec tauri build --bundles app --target "$LEAFLET_BUILD_TARGET"
    exit $?
fi
exec pnpm exec tauri build --bundles app --target "$LEAFLET_BUILD_TARGET"
