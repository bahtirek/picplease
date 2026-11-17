import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuildInfo, UNKNOWN_BUILD } from './build-info';

describe('readBuildInfo', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-info-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads commit and builtAt from the file', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(file, JSON.stringify({ commit: '51bea1d', builtAt: '2026-11-16T10:00:00.000Z' }));
    expect(readBuildInfo(file)).toEqual({ commit: '51bea1d', builtAt: '2026-11-16T10:00:00.000Z' });
  });

  it('gives unknown when the file is missing', () => {
    expect(readBuildInfo(join(dir, 'missing.json'))).toEqual(UNKNOWN_BUILD);
  });

  it('gives unknown when the file is malformed or has the wrong shape', () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(readBuildInfo(bad)).toEqual(UNKNOWN_BUILD);
    const wrong = join(dir, 'wrong.json');
    writeFileSync(wrong, JSON.stringify({ commit: 42 }));
    expect(readBuildInfo(wrong)).toEqual(UNKNOWN_BUILD);
  });
});
