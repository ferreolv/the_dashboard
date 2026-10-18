#!/usr/bin/env node
// Prepare only: network access and credentials are deliberately unnecessary.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'backups/dashboard-public-kv.json');
// Keep this explicit: never walk the workspace or include dashboard backups.
const publicFiles = [
  ['index.html', '__html__'],
  ['dashboard.webmanifest', 'asset:/dashboard.webmanifest'],
  ['assets/icons/favicon-32.png', 'asset:/assets/icons/favicon-32.png'],
  ['assets/icons/apple-touch-icon.png', 'asset:/assets/icons/apple-touch-icon.png'],
  ['assets/icons/dashboard-192.png', 'asset:/assets/icons/dashboard-192.png'],
  ['assets/icons/dashboard-512.png', 'asset:/assets/icons/dashboard-512.png'],
  ['assets/icons/dashboard-maskable-512.png', 'asset:/assets/icons/dashboard-maskable-512.png'],
];

if (process.argv.includes('--help')) {
  console.log('Usage: node worker/prepare-dashboard-assets.mjs');
  console.log('Prepares seven public files in backups/dashboard-public-kv.json; does not publish.');
} else {
  try {
    if (process.argv.length > 2) throw new Error('Unknown argument. Use --help.');
    const canonicalRoot = await realpath(root);
    const entries = [];
    const summary = [];
    for (const [file, key] of publicFiles) {
      const canonicalFile = await realpath(resolve(root, file));
      const withinRoot = relative(canonicalRoot, canonicalFile);
      if (withinRoot === '..' || withinRoot.startsWith('..' + String.fromCharCode(92)) || withinRoot.startsWith('../') || isAbsolute(withinRoot)) {
        throw new Error('Public file resolves outside the project: ' + file);
      }
      const bytes = await readFile(canonicalFile);
      if (!bytes.length) throw new Error('Public file is empty: ' + file);
      if (file.endsWith('.png') && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        throw new Error('Invalid PNG: ' + file);
      }
      if (file.endsWith('.webmanifest')) JSON.parse(bytes.toString('utf8'));
      // Wrangler kv bulk put decodes each value when base64 is true. This also
      // preserves the HTML's exact UTF-8 bytes and all binary icon bytes.
      entries.push({ key, value: bytes.toString('base64'), base64: true });
      summary.push({ key, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(entries, null, 2) + '\n', 'utf8');
    console.table(summary);
    console.log('Prepared: ' + output);
    console.log('Publish after validation: npx wrangler kv bulk put backups/dashboard-public-kv.json --binding SYNC --remote --config worker/wrangler.toml');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
