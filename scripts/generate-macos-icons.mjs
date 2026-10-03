import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'leaflet-macos-icons-'));
const output = join(project, 'src-tauri/icons/macos');
try {
  // Keep the existing artwork, with a 100px transparent inset on a 1024px canvas.
  // The 824px tile has the same visual footprint as standard macOS Dock icons.
  const source = readFileSync(join(project, 'public/leaflet.svg'), 'utf8');
  const padded = source
    .replace(
      /<svg\b[^>]*>/,
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64"><g transform="translate(6.25 6.25) scale(0.8046875)">',
    )
    .replace('</svg>', '</g></svg>');
  const input = join(scratch, 'leaflet-macos.svg');
  writeFileSync(input, padded);
  const generated = join(scratch, 'generated');
  const result = spawnSync(
    'pnpm',
    ['exec', 'tauri', 'icon', input, '--output', generated],
    { cwd: project, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Icon generation failed (${result.status})`);
  mkdirSync(output, { recursive: true });
  for (const filename of [
    '32x32.png',
    '128x128.png',
    '128x128@2x.png',
    'icon.icns',
  ]) {
    copyFileSync(join(generated, filename), join(output, filename));
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
