import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Runs at the end of `npm run build` (from dist/scripts) and writes dist/build-info.json,
// which GET /health reports. "-dirty" marks a build from uncommitted changes.
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const commit = git(['rev-parse', '--short', 'HEAD']);
const dirty = commit !== null && git(['status', '--porcelain']) !== '';
const info = {
  commit: commit === null ? 'unknown' : `${commit}${dirty ? '-dirty' : ''}`,
  builtAt: new Date().toISOString(),
};

writeFileSync(join(__dirname, '..', 'build-info.json'), `${JSON.stringify(info)}\n`);
console.log(`Build ${info.commit} at ${info.builtAt}`);
