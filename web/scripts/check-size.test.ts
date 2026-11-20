import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, 'check-size.mjs');
let dir: string;

function run(): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('size check (test 18)', () => {
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when JS plus CSS is under 40 KB gzip, counting nested assets', () => {
    dir = mkdtempSync(join(tmpdir(), 'size-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'index.js'), 'console.log(1);'.repeat(1000));
    writeFileSync(join(dir, 'assets', 'index.css'), 'a{color:red}');
    writeFileSync(join(dir, 'big.png'), randomBytes(100 * 1024));
    expect(run().status).toBe(0);
  });

  it('fails when JS plus CSS exceeds 40 KB gzip', () => {
    dir = mkdtempSync(join(tmpdir(), 'size-'));
    // Random bytes do not compress, so 41 KB stays above the budget.
    writeFileSync(join(dir, 'index.js'), randomBytes(41 * 1024).toString('base64'));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('exceeds');
  });

  it('fails when there is nothing to check', () => {
    dir = mkdtempSync(join(tmpdir(), 'size-'));
    expect(run().status).toBe(1);
  });
});
