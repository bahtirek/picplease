import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BuildInfo {
  commit: string;
  builtAt: string;
}

export const UNKNOWN_BUILD: BuildInfo = { commit: 'unknown', builtAt: 'unknown' };

/** Written by `npm run build` (scripts/write-build-info.ts) next to dist/src. */
export const BUILD_INFO_FILE = join(__dirname, '..', '..', 'build-info.json');

/** Reads the build file; a missing or malformed file (dev, tests) gives UNKNOWN_BUILD. */
export function readBuildInfo(file: string = BUILD_INFO_FILE): BuildInfo {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'commit' in parsed &&
      'builtAt' in parsed &&
      typeof parsed.commit === 'string' &&
      typeof parsed.builtAt === 'string'
    ) {
      return { commit: parsed.commit, builtAt: parsed.builtAt };
    }
  } catch {
    // Fall through to unknown.
  }
  return UNKNOWN_BUILD;
}
