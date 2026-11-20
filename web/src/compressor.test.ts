import { describe, expect, it, vi } from 'vitest';
import {
  CompressError,
  JPEG_QUALITIES,
  PHOTO_MAX_EDGE,
  drawScaled,
  encodeJpeg,
  fitWithin,
  type CanvasLike,
  type Context2DLike,
} from './compressor';

const MB = 1024 * 1024;
const LIMIT = 5 * MB;

/** A canvas whose toBlob answers with a blob of the given size and type per quality. */
function fakeCanvas(sizeFor: (quality: number) => number, type = 'image/jpeg') {
  const drawImage = vi.fn<Context2DLike['drawImage']>();
  const qualities: number[] = [];
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob(callback, _type, quality = 0.92) {
      qualities.push(quality);
      queueMicrotask(() => {
        callback(new Blob([new Uint8Array(sizeFor(quality))], { type }));
      });
    },
  };
  return { canvas, drawImage, qualities };
}

describe('fitWithin', () => {
  it.each([
    [4032, 3024, 1920, 1440],
    [3024, 4032, 1440, 1920],
    [1920, 1080, 1920, 1080],
    [1280, 720, 1280, 720],
    [7000, 10, 1920, 3],
  ])('%i x %i becomes %i x %i (never upscaled)', (w, h, ew, eh) => {
    expect(fitWithin(w, h)).toEqual({ width: ew, height: eh });
  });
});

describe('compressor (test 5)', () => {
  it('draws once at the scaled size and encodes JPEG at quality 0.7', async () => {
    const { canvas, drawImage, qualities } = fakeCanvas(() => 800_000);
    const source = {} as CanvasImageSource;
    const drawn = drawScaled(source, 4032, 3024, () => canvas);
    expect([drawn.width, drawn.height]).toEqual([1920, 1440]);
    expect(Math.max(drawn.width, drawn.height)).toBeLessThanOrEqual(PHOTO_MAX_EDGE);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0, 1920, 1440);

    const blob = await encodeJpeg(drawn, LIMIT);
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeLessThan(LIMIT);
    expect(qualities).toEqual([0.7]);
  });

  it('lowers the quality only when the photo is over the limit', async () => {
    const { canvas, qualities } = fakeCanvas((q) => (q > 0.6 ? 6 * MB : 3 * MB));
    const blob = await encodeJpeg(canvas, LIMIT);
    expect(blob.size).toBe(3 * MB);
    expect(qualities).toEqual([0.7, 0.5]);
  });

  it('gives up when even the lowest quality is over the limit', async () => {
    const { canvas, qualities } = fakeCanvas(() => 6 * MB);
    await expect(encodeJpeg(canvas, LIMIT)).rejects.toThrow(CompressError);
    expect(qualities).toEqual([...JPEG_QUALITIES]);
  });

  it('refuses a browser that falls back to another format', async () => {
    const { canvas } = fakeCanvas(() => 1000, 'image/png');
    await expect(encodeJpeg(canvas, LIMIT)).rejects.toThrow('JPEG not supported');
  });

  it('refuses an empty or failed encode', async () => {
    await expect(encodeJpeg(fakeCanvas(() => 0).canvas, LIMIT)).rejects.toThrow(CompressError);
    const failing: CanvasLike = {
      width: 1,
      height: 1,
      getContext: () => null,
      toBlob: (callback) => {
        callback(null);
      },
    };
    await expect(encodeJpeg(failing, LIMIT)).rejects.toThrow('Encoding failed');
  });

  it('releases the canvas after encoding, on success and failure', async () => {
    const ok = fakeCanvas(() => 1000).canvas;
    ok.width = 1920;
    ok.height = 1080;
    await encodeJpeg(ok, LIMIT);
    expect([ok.width, ok.height]).toEqual([0, 0]);

    const bad = fakeCanvas(() => 6 * MB).canvas;
    bad.width = 1920;
    await encodeJpeg(bad, LIMIT).catch(() => undefined);
    expect(bad.width).toBe(0);
  });

  it('refuses an empty source or a missing 2D context', () => {
    const { canvas } = fakeCanvas(() => 1);
    expect(() => drawScaled({} as CanvasImageSource, 0, 100, () => canvas)).toThrow(CompressError);
    const noContext: CanvasLike = { ...canvas, getContext: () => null };
    expect(() => drawScaled({} as CanvasImageSource, 10, 10, () => noContext)).toThrow(
      'No 2D context',
    );
  });
});
