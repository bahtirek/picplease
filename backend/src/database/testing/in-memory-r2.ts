import {
  checkContentType,
  checkTtl,
  type DeleteManyResult,
  type ObjectInfo,
  type R2Client,
  type SignedDownload,
  type SignedUpload,
} from '../r2.client';
import { assertR2Key, type R2Key } from '../r2-key';

/** Runs `fn` and returns its result as a promise, so a thrown check becomes a rejection. */
function settle<T>(fn: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(fn());
  });
}

/**
 * Fake R2 for tests of other modules. Same checks as the real client; objects live
 * in a Map. `put` stands in for a phone uploading with the signed URL.
 */
export class InMemoryR2Client implements R2Client {
  readonly objects = new Map<R2Key, ObjectInfo>();
  /** Keys passed to delete or deleteMany, in order. */
  readonly deleted: R2Key[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  put(key: R2Key, size: number, contentType = 'image/jpeg'): void {
    assertR2Key(key);
    this.objects.set(key, { size, contentType, etag: `"${String(size)}"` });
  }

  signUpload(key: R2Key, contentType: string, ttlSeconds: number): Promise<SignedUpload> {
    return settle(() => {
      assertR2Key(key);
      checkContentType(contentType);
      checkTtl(ttlSeconds);
      const expiresAt = this.expiry(ttlSeconds);
      return {
        url: this.url('put', key, expiresAt),
        headers: { 'content-type': contentType },
        expiresAt,
      };
    });
  }

  signDownload(key: R2Key, ttlSeconds: number): Promise<SignedDownload> {
    return settle(() => {
      assertR2Key(key);
      checkTtl(ttlSeconds);
      const expiresAt = this.expiry(ttlSeconds);
      return { url: this.url('get', key, expiresAt), expiresAt };
    });
  }

  head(key: R2Key): Promise<ObjectInfo | null> {
    return settle(() => {
      assertR2Key(key);
      const info = this.objects.get(key);
      return info ? { ...info } : null;
    });
  }

  delete(key: R2Key): Promise<void> {
    return settle(() => {
      assertR2Key(key);
      this.objects.delete(key);
      this.deleted.push(key);
    });
  }

  deleteMany(keys: readonly R2Key[]): Promise<DeleteManyResult> {
    return settle(() => {
      for (const key of keys) assertR2Key(key);
      for (const key of keys) {
        this.objects.delete(key);
        this.deleted.push(key);
      }
      return { failed: [] };
    });
  }

  private expiry(ttlSeconds: number): Date {
    return new Date(this.now().getTime() + ttlSeconds * 1000);
  }

  private url(op: string, key: R2Key, expiresAt: Date): string {
    return `https://r2.fake/${key}?op=${op}&expires=${expiresAt.toISOString()}`;
  }
}

/** Settings for tests that build an AppConfig. Nothing is ever sent to this endpoint. */
export const TEST_R2_SETTINGS = {
  endpoint: 'https://r2.invalid',
  bucket: 'picplease-photos-test',
  accessKeyId: 'test-id',
  secretAccessKey: 'test-secret',
} as const;
