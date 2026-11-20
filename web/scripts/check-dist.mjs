// Checks the build output against the hosting rules (docs/web/hosting.md): no inline scripts or
// styles (the CSP allows only 'self'), no external URLs in index.html, and valid app link files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEAM_APP_ID = '44NBW3DS2Q.app.picplease';

export function checkDist(dir) {
  const problems = [];
  const read = (path) => {
    try {
      return readFileSync(join(dir, path), 'utf8');
    } catch {
      problems.push(`${path} is missing`);
      return null;
    }
  };

  const html = read('index.html');
  if (html !== null) {
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc=/.test(match[1]) || match[2].trim() !== '')
        problems.push('index.html has an inline script');
    }
    if (/<style\b/i.test(html) || /\sstyle=/i.test(html))
      problems.push('index.html has inline styles');
    if (/\s(?:src|href)="(?:https?:)?\/\//i.test(html))
      problems.push('index.html loads from another origin');
  }

  const aasa = read('.well-known/apple-app-site-association');
  if (aasa !== null) {
    try {
      const details = JSON.parse(aasa).applinks?.details ?? [];
      const ok = details.some(
        (d) => d.appIDs?.includes(TEAM_APP_ID) && d.components?.some((c) => c['/'] === '/s/*'),
      );
      if (!ok) problems.push(`apple-app-site-association does not map /s/* to ${TEAM_APP_ID}`);
    } catch {
      problems.push('apple-app-site-association is not valid JSON');
    }
  }

  const assetlinks = read('.well-known/assetlinks.json');
  if (assetlinks !== null) {
    try {
      if (!Array.isArray(JSON.parse(assetlinks))) problems.push('assetlinks.json is not an array');
    } catch {
      problems.push('assetlinks.json is not valid JSON');
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkDist(process.argv[2] ?? 'dist');
  if (problems.length > 0) {
    for (const problem of problems) console.error(`dist check: ${problem}`);
    process.exit(1);
  }
  console.log('dist check: ok');
}
