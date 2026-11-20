// Fails if the gzip size of all JS plus CSS in dist/ exceeds the budget (docs/web/overview.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 40 * 1024;

export function listAssets(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listAssets(path));
    else if (['.js', '.mjs', '.css'].includes(extname(name))) out.push(path);
  }
  return out;
}

export function gzipTotal(files) {
  return files.reduce((sum, file) => sum + gzipSync(readFileSync(file), { level: 9 }).length, 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'dist';
  const files = listAssets(dir);
  if (files.length === 0) {
    console.error(`size check: no JS or CSS found in ${dir}/ (run the build first)`);
    process.exit(1);
  }
  const total = gzipTotal(files);
  const kb = (n) => (n / 1024).toFixed(1);
  if (total > BUDGET_BYTES) {
    console.error(`size check: ${kb(total)} KB gzip exceeds ${kb(BUDGET_BYTES)} KB`);
    process.exit(1);
  }
  console.log(`size check: ${kb(total)} KB gzip of ${kb(BUDGET_BYTES)} KB`);
}
