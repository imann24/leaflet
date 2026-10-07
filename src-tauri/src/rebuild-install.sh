#!/bin/sh
# Invoked with arguments (never interpolated shell source) by the native app.
set -eu
pid=$1
destination=$2
staging=$3
backup="$staging/previous.app"
staged="$staging/new.app"
: > "$staging/ready"

# Never replace an app that is still running. Give graceful Tauri exit time.
attempt=0
while kill -0 "$pid" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        echo 'Update failed: Leaflet did not exit. The current app is unchanged.'
        rm -rf "$staging"
        exit 1
    fi
    sleep 1
done

if ! mv "$destination" "$backup"; then
    echo 'Update failed: could not move the current app; reopening it.'
    open -n "$destination"
    exit 1
fi
if ! mv "$staged" "$destination"; then
    echo 'Update failed: could not install the build; restoring the previous app.'
    mv "$backup" "$destination"
    open -n "$destination"
    exit 1
fi
if ! open -n "$destination"; then
    echo 'Update failed: could not launch the build; restoring the previous app.'
    mv "$destination" "$staged"
    mv "$backup" "$destination"
    open -n "$destination"
    exit 1
fi
echo 'Local rebuild installed and launched.'
rm -rf "$staging"
