import { describe, expect, it, vi } from 'vitest';
import {
  CAMERA_CONSTRAINTS,
  CameraError,
  captureFrame,
  enableCamera,
  openCamera,
  stopCamera,
  type MediaDevicesLike,
  type VideoLike,
} from './camera';
import type { CanvasLike, Context2DLike } from './compressor';
import { createStore } from './state';

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, tracks };
}

function fakeVideo(play: () => Promise<void> = () => Promise.resolve(), size = [1920, 1080]) {
  const attributes = new Map<string, string>();
  const video: VideoLike = {
    srcObject: null,
    muted: false,
    playsInline: false,
    videoWidth: size[0] ?? 0,
    videoHeight: size[1] ?? 0,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    play,
  };
  return { video, attributes };
}

function devicesThat(result: MediaStream | Error) {
  const getUserMedia = vi.fn<MediaDevicesLike['getUserMedia']>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  return { devices: { getUserMedia }, getUserMedia };
}

describe('camera', () => {
  it('asks for the rear camera without audio and starts shooting', async () => {
    const { stream } = fakeStream();
    const { devices, getUserMedia } = devicesThat(stream);
    const { video, attributes } = fakeVideo();
    const store = createStore();

    expect(await enableCamera({ store, video, devices })).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(CAMERA_CONSTRAINTS.audio).toBe(false);
    expect(CAMERA_CONSTRAINTS.video).toMatchObject({ facingMode: { ideal: 'environment' } });
    expect(video.srcObject).toBe(stream);
    expect(video.muted && video.playsInline && attributes.has('playsinline')).toBe(true);
    expect(store.get().screen).toBe('shooting');
  });

  it.each(['NotAllowedError', 'SecurityError'])(
    'camera denied (%s) leads to noCamera (test 15)',
    async (name) => {
      const { devices } = devicesThat(new DOMException('no', name));
      const store = createStore();
      expect(await enableCamera({ store, video: fakeVideo().video, devices })).toBeNull();
      expect(store.get()).toMatchObject({ screen: 'noCamera', cameraProblem: 'denied' });
    },
  );

  it.each(['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError'])(
    'no usable camera (%s) leads to noCamera, unavailable',
    async (name) => {
      const { devices } = devicesThat(new DOMException('no', name));
      const store = createStore();
      await enableCamera({ store, video: fakeVideo().video, devices });
      expect(store.get()).toMatchObject({ screen: 'noCamera', cameraProblem: 'unavailable' });
    },
  );

  it('a browser without getUserMedia (or an insecure page) is unavailable', async () => {
    await expect(openCamera(undefined)).rejects.toMatchObject({ problem: 'unavailable' });
    const store = createStore();
    await enableCamera({ store, video: fakeVideo().video, devices: {} as MediaDevicesLike });
    expect(store.get()).toMatchObject({ screen: 'noCamera', cameraProblem: 'unavailable' });
  });

  it('stops the tracks and detaches when the viewfinder cannot play', async () => {
    const { stream, tracks } = fakeStream();
    const { devices } = devicesThat(stream);
    const { video } = fakeVideo(() => Promise.reject(new Error('blocked')));
    const store = createStore();
    expect(await enableCamera({ store, video, devices })).toBeNull();
    expect(video.srcObject).toBeNull();
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(store.get()).toMatchObject({ screen: 'noCamera', cameraProblem: 'unavailable' });
  });

  it('stopCamera stops every track and accepts null', () => {
    const { stream, tracks } = fakeStream();
    stopCamera(stream);
    stopCamera(null);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it('captures the current frame scaled to at most 1920 px', () => {
    const drawImage = vi.fn<Context2DLike['drawImage']>();
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: vi.fn(),
    };
    const { video } = fakeVideo(undefined, [2160, 3840]);
    const frame = captureFrame(video, () => canvas);
    expect([frame.width, frame.height]).toEqual([1080, 1920]);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1080, 1920);
  });

  it('refuses to capture before the video has a frame', () => {
    const { video } = fakeVideo(undefined, [0, 0]);
    expect(() => captureFrame(video)).toThrow(CameraError);
  });
});
