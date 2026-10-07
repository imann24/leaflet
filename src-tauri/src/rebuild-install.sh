#!/bin/sh
# Invoked with arguments (never interpolated shell source) by the native app.
set -eu
pid=$1
destination=$2
staging=$3
error_marker=$4
report_failure() {
    echo "Update failed: $1" || :
    # Publish before reopening the old app; it consumes this marker once.
    # Reporting is best-effort: a full disk must not prevent rollback.
    if ! (printf '%s\n' "$1" > "$error_marker.tmp" && mv "$error_marker.tmp" "$error_marker"); then
        echo 'Could not save the installer error marker.' >&2 || :
    fi
}
backup="$staging/previous.app"
staged="$staging/new.app"
: > "$staging/ready"

# Never replace an app that is still running. Give graceful Tauri exit time.
attempt=0
while kill -0 "$pid" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        report_failure 'Leaflet did not exit. The current app is unchanged.'
        rm -rf "$staging"
        exit 1
    fi
    sleep 1
done

if ! mv "$destination" "$backup"; then
    report_failure 'could not move the current app; reopening it.'
    open -n "$destination"
    exit 1
fi
if ! mv "$staged" "$destination"; then
    report_failure 'could not install the build; restoring the previous app.'
    mv "$backup" "$destination"
    open -n "$destination"
    exit 1
fi
if ! open -n "$destination"; then
    report_failure 'could not launch the build; restoring the previous app.'
    mv "$destination" "$staged"
    mv "$backup" "$destination"
    open -n "$destination"
    exit 1
fi
echo 'Local rebuild installed and launched.'
rm -rf "$staging"
