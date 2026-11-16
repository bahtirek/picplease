import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertR2Key, type R2Key } from './r2-key';

export const R2_CLIENT = Symbol('R2_CLIENT');

export interface R2Settings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** S3 allows presigned URLs to live at most 7 days. */
export const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SignedUpload {
  url: string;
  /** Headers the uploader must send exactly as given; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface SignedDownload {
  url: string;
  expiresAt: Date;
}

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
  etag: string | undefined;
}

export interface DeleteManyResult {
  /** Keys R2 refused to delete. A key that does not exist counts as deleted. */
  failed: R2Key[];
}

/**
 * Signed URLs and object calls for the photo bucket. Photo bytes never pass
 * through the API: clients PUT and GET with the signed URLs.
 *
 * Size: R2 cannot limit an upload to a range of sizes (no POST policy, and a signed
 * Content-Length only pins one exact value), so `head` after upload is the real
 * size check. See docs/backend/modules/data-layer.md.
 */
export interface R2Client {
  signUpload(key: R2Key, contentType: string, ttlSeconds: number): Promise<SignedUpload>;
  signDownload(key: R2Key, ttlSeconds: number): Promise<SignedDownload>;
  /** Null when the object does not exist. */
  head(key: R2Key): Promise<ObjectInfo | null>;
  /** Succeeds when the object is already gone. */
  delete(key: R2Key): Promise<void>;
  deleteMany(keys: readonly R2Key[]): Promise<DeleteManyResult>;
}

/** DeleteObjects takes at most 1000 keys per request. */
const DELETE_BATCH = 1000;

export function checkTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_SIGNED_URL_TTL_SECONDS) {
    throw new RangeError(
      `ttlSeconds must be an integer from 1 to ${String(MAX_SIGNED_URL_TTL_SECONDS)}`,
    );
  }
}

export function checkContentType(contentType: string): void {
  // Becomes a signed header, so refuse anything that could break the header line.
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) {
    throw new RangeError('contentType must be a plain type/subtype');
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

export class S3R2Client implements R2Client {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    settings: R2Settings,
    private readonly now: () => Date = () => new Date(),
    /** Tests replace the HTTP layer; nothing else should. */
    overrides: Partial<S3ClientConfig> = {},
  ) {
    this.bucket = settings.bucket;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: settings.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      // Default checksums would add x-amz-checksum-* parameters to presigned PUT
      // URLs that a phone uploading arbitrary bytes cannot satisfy.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      ...overrides,
    });
  }

  async signUpload(key: R2Key, contentType: string, ttlSeconds: number): Promise<SignedUpload> {
    assertR2Key(key);
    checkContentType(contentType);
    checkTtl(ttlSeconds);
    const signingDate = this.now();
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttlSeconds, signingDate, signableHeaders: new Set(['content-type']) },
    );
    return {
      url,
      headers: { 'content-type': contentType },
      expiresAt: new Date(signingDate.getTime() + ttlSeconds * 1000),
    };
  }

  async signDownload(key: R2Key, ttlSeconds: number): Promise<SignedDownload> {
    assertR2Key(key);
    checkTtl(ttlSeconds);
    const signingDate = this.now();
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds, signingDate },
    );
    return { url, expiresAt: new Date(signingDate.getTime() + ttlSeconds * 1000) };
  }

  async head(key: R2Key): Promise<ObjectInfo | null> {
    assertR2Key(key);
    try {
      const out = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType, etag: out.ETag };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: R2Key): Promise<void> {
    assertR2Key(key);
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async deleteMany(keys: readonly R2Key[]): Promise<DeleteManyResult> {
    for (const key of keys) assertR2Key(key);
    const unique = [...new Set(keys)];
    const failed: R2Key[] = [];
    for (let i = 0; i < unique.length; i += DELETE_BATCH) {
      const batch = unique.slice(i, i + DELETE_BATCH);
      const out = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      for (const error of out.Errors ?? []) {
        if (error.Code === 'NoSuchKey') continue;
        const key = batch.find((k) => k === error.Key);
        if (key) failed.push(key);
      }
    }
    return { failed };
  }
}
