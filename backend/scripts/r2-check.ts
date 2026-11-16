import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRODUCTION_BUCKET } from '../src/common/config/config';
import { S3R2Client } from '../src/database/r2.client';
import { buildKey } from '../src/database/r2-key';

// Manual check of the R2 client against the DEV bucket. Run with `npm run r2:check`.
// Prints only pass/fail lines: never URLs, keys or credentials.

const env = process.env;
const settings = {
  endpoint: env.R2_ENDPOINT ?? '',
  bucket: env.R2_BUCKET ?? '',
  accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
  secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
};

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function put(url: string, body: Buffer, headers: Record<string, string>): Promise<number> {
  const res = await fetch(url, { method: 'PUT', body, headers });
  await res.arrayBuffer();
  return res.status;
}

async function main(): Promise<void> {
  const missing = Object.entries(settings).filter(([, v]) => !v);
  if (missing.length > 0) {
    console.error(`Missing R2 settings: ${missing.map(([k]) => k).join(', ')}`);
    process.exit(1);
  }
  if (env.NODE_ENV === 'production' || settings.bucket === PRODUCTION_BUCKET) {
    console.error('Refusing to run against production');
    process.exit(1);
  }

  const r2 = new S3R2Client(settings);
  const session = randomUUID();
  const key = buildKey(session, randomUUID());
  const other = buildKey(session, randomUUID());
  const jpeg = { 'content-type': 'image/jpeg' };
  const small = Buffer.alloc(1000, 1);

  // Upload, head, download.
  const upload = await r2.signUpload(key, 'image/jpeg', 60);
  check('PUT with signed URL', (await put(upload.url, small, upload.headers)) === 200);
  const info = await r2.head(key);
  check('head returns size and type', info?.size === 1000 && info.contentType === 'image/jpeg');
  const download = await r2.signDownload(key, 60);
  const got = Buffer.from(await (await fetch(download.url)).arrayBuffer());
  check('GET with signed URL returns the bytes', got.equals(small));

  // The content type is part of the signature.
  const wrongType = await put(upload.url, small, { 'content-type': 'image/png' });
  check(
    'PUT with a different content type is refused',
    wrongType === 403,
    `status ${String(wrongType)}`,
  );

  // Size pinning, 1: our upload URL does not limit the size (head is the enforcement).
  const big = Buffer.alloc(6 * 1024 * 1024, 2);
  const bigStatus = await put(upload.url, big, upload.headers);
  const bigInfo = await r2.head(key);
  check(
    'FINDING: upload URL accepts 6 MB (no size limit in the signature)',
    bigStatus === 200 && bigInfo?.size === big.length,
    `status ${String(bigStatus)}`,
  );

  // Size pinning, 2: a signed Content-Length pins one exact size.
  const s3 = new S3Client({
    region: 'auto',
    endpoint: settings.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const pinned = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: other,
      ContentType: 'image/jpeg',
      ContentLength: 1000,
    }),
    { expiresIn: 60, signableHeaders: new Set(['content-type', 'content-length']) },
  );
  const pinnedWrong = await put(pinned, Buffer.alloc(2000, 3), jpeg);
  check(
    'FINDING: signed Content-Length refuses another size',
    pinnedWrong === 403,
    `status ${String(pinnedWrong)}`,
  );
  const pinnedRight = await put(pinned, small, jpeg);
  check(
    'signed Content-Length accepts the exact size',
    pinnedRight === 200,
    `status ${String(pinnedRight)}`,
  );

  // Expiry.
  const short = await r2.signDownload(key, 1);
  await new Promise((r) => setTimeout(r, 2500));
  const expired = await fetch(short.url);
  await expired.arrayBuffer();
  check('expired URL is refused', expired.status === 403, `status ${String(expired.status)}`);

  // Delete.
  await r2.delete(key);
  await r2.delete(key);
  check('delete twice succeeds, head then returns null', (await r2.head(key)) === null);
  const result = await r2.deleteMany([other, key]);
  check(
    'deleteMany removes objects and ignores missing ones',
    result.failed.length === 0 && (await r2.head(other)) === null,
  );

  console.log(failures === 0 ? 'All checks passed' : `${String(failures)} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'R2 check failed');
  process.exit(1);
});
