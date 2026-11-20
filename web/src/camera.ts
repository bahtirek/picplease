/** getUserMedia (rear camera), attach to the viewfinder, capture a frame, stop the tracks. */
import { drawScaled, type CanvasFactory, type CanvasLike } from './compressor';
import type { Store } from './state';

/** denied: the person or the browser refused; unavailable: no camera, busy, or not supported. */
export type CameraProblem = 'denied' | 'unavailable';

export class CameraError extends Error {
  override name = 'CameraError';
  constructor(readonly problem: CameraProblem) {
    super(problem);
  }
}

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface VideoLike {
  srcObject: MediaProvider | null;
  muted: boolean;
  playsInline: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  setAttribute(name: string, value: string): void;
  play(): Promise<void>;
}

/** Rear camera when there is one (ideal, so a laptop still works); no audio. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

function defaultDevices(): MediaDevicesLike | undefined {
  // mediaDevices is missing outside a secure context and in old browsers, whatever the types say.
  if (typeof navigator === 'undefined') return undefined;
  return navigator.mediaDevices;
}

export function cameraProblem(error: unknown): CameraProblem {
  if (error instanceof CameraError) return error.problem;
  const name = error instanceof Error ? error.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
}

export async function openCamera(
  devices: MediaDevicesLike | undefined = defaultDevices(),
): Promise<MediaStream> {
  if (typeof devices?.getUserMedia !== 'function') throw new CameraError('unavailable');
  try {
    return await devices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (error) {
    throw new CameraError(cameraProblem(error));
  }
}

export function stopCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Shows the stream in the viewfinder; inline and muted so iOS plays it without a tap. */
export async function attachCamera(video: VideoLike, stream: MediaStream): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    video.srcObject = null;
    throw new CameraError('unavailable');
  }
}

export interface EnableCameraDeps {
  store: Store;
  video: VideoLike;
  devices?: MediaDevicesLike | undefined;
}

/** "Allow camera": opens the camera and moves to shooting, or to noCamera on failure. */
export async function enableCamera(deps: EnableCameraDeps): Promise<MediaStream | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await openCamera(deps.devices ?? defaultDevices());
    await attachCamera(deps.video, stream);
    deps.store.set({ screen: 'shooting', cameraProblem: null });
    return stream;
  } catch (error) {
    stopCamera(stream);
    deps.store.set({ screen: 'noCamera', cameraProblem: cameraProblem(error) });
    return null;
  }
}

/** Grabs the current frame, already scaled to at most 1920 px on the longest edge. */
export function captureFrame(video: VideoLike, createCanvas?: CanvasFactory): CanvasLike {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    throw new CameraError('unavailable');
  }
  return drawScaled(
    video as unknown as CanvasImageSource,
    video.videoWidth,
    video.videoHeight,
    createCanvas,
  );
}
