/**
 * Canvas resize and JPEG encode (docs/web/flow-and-states.md). A canvas re-encode carries no EXIF,
 * so location and other metadata are never sent. Frames from the camera stream are already upright.
 */

/** Longest edge of a sent photo, in pixels. Never upscaled. */
export const PHOTO_MAX_EDGE = 1920;
/** First JPEG quality tried; lower ones only if the photo is over the size limit. */
export const JPEG_QUALITIES = [0.7, 0.5, 0.35] as const;

export interface Context2DLike {
  drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  imageSmoothingEnabled?: boolean;
  imageSmoothingQuality?: ImageSmoothingQuality;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): Context2DLike | null;
  toBlob(callback: BlobCallback, type?: string, quality?: number): void;
}

export type CanvasFactory = () => CanvasLike;

export const createDomCanvas: CanvasFactory = () => document.createElement('canvas');

export class CompressError extends Error {
  override name = 'CompressError';
}

/** Scales (width, height) so the longest edge is at most maxEdge, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Draws the source once, already scaled, so a full-size copy is never held in memory. */
export function drawScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  createCanvas: CanvasFactory = createDomCanvas,
  maxEdge: number = PHOTO_MAX_EDGE,
): CanvasLike {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new CompressError('Nothing to draw');
  }
  const { width, height } = fitWithin(sourceWidth, sourceHeight, maxEdge);
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new CompressError('No 2D context');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function toBlob(canvas: CanvasLike, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

/**
 * Encodes the canvas as JPEG under maxBytes, trying lower qualities only when needed. Releases the
 * canvas afterwards (iOS Safari caps total canvas memory).
 */
export async function encodeJpeg(canvas: CanvasLike, maxBytes: number): Promise<Blob> {
  try {
    for (const quality of JPEG_QUALITIES) {
      const blob = await toBlob(canvas, quality);
      if (!blob) throw new CompressError('Encoding failed');
      if (blob.type !== 'image/jpeg') throw new CompressError('JPEG not supported');
      if (blob.size === 0) throw new CompressError('Empty photo');
      if (blob.size <= maxBytes) return blob;
    }
    throw new CompressError('Photo too large');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
