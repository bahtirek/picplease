import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module script without types
import { checkDist } from './check-dist.mjs';

const check = checkDist as (dir: string) => string[];
const GOOD_HTML =
  '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-a.js"></script>' +
  '<link rel="stylesheet" href="/assets/index-a.css"></head><body><main id="app"></main></body></html>';
const AASA = JSON.stringify({
  applinks: { details: [{ appIDs: ['44NBW3DS2Q.app.picplease'], components: [{ '/': '/s/*' }] }] },
});

let dir: string;
function dist(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(dir, '.well-known'));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  return dir;
}
const complete = (overrides: Record<string, string> = {}) => ({
  'index.html': GOOD_HTML,
  '.well-known/apple-app-site-association': AASA,
  '.well-known/assetlinks.json': '[]',
  ...overrides,
});

describe('dist check', () => {
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes a build that fits the CSP and has the link files', () => {
    expect(check(dist(complete()))).toEqual([]);
  });

  it('refuses inline scripts, inline styles and other origins', () => {
    expect(check(dist(complete({ 'index.html': '<script>alert(1)</script>' })))).toEqual([
      'index.html has an inline script',
    ]);
    rmSync(dir, { recursive: true });
    expect(check(dist(complete({ 'index.html': '<div style="color:red"></div>' })))).toEqual([
      'index.html has inline styles',
    ]);
    rmSync(dir, { recursive: true });
    expect(
      check(dist(complete({ 'index.html': '<script src="https://cdn.example/x.js"></script>' }))),
    ).toEqual(['index.html loads from another origin']);
  });

  it('refuses missing or wrong link files', () => {
    expect(
      check(dist({ 'index.html': GOOD_HTML, '.well-known/apple-app-site-association': '{}' })),
    ).toEqual([
      'apple-app-site-association does not map /s/* to 44NBW3DS2Q.app.picplease',
      '.well-known/assetlinks.json is missing',
    ]);
  });
});
