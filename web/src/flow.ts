/**
 * The helper flow after the claim, following the mobile helper (docs/mobile/helper.md):
 * allow camera, shoot back to back, Finish, wait for the uploads, thanks. Screens call these
 * actions; lifecycle and realtime (W6) call sessionFinished and sessionEnded.
 */
import type { ApiClient } from './api';
import {
  captureFrame,
  enableCamera,
  stopCamera,
  type MediaDevicesLike,
  type VideoLike,
} from './camera';
import type { CanvasFactory } from './compressor';
import type { Store } from './state';
import type { TokenStore } from './tokenStore';
import { Uploader, type StopReason, type UploaderDeps } from './uploader';

export type ShootResult = 'accepted' | 'full' | 'offline' | 'stopped' | 'error';

export interface FlowDeps {
  store: Store;
  api: Pick<ApiClient, 'issueUpload' | 'confirm' | 'finish'>;
  tokens: TokenStore;
  video: VideoLike;
  devices?: MediaDevicesLike;
  createCanvas?: CanvasFactory;
  /** Passed to the uploader (tests use fakes). */
  uploader?: Pick<UploaderDeps, 'fetch' | 'encode' | 'sleep'>;
}

export class HelperFlow {
  private stream: MediaStream | null = null;
  private uploader: Uploader | null = null;
  private wrapping = false;

  constructor(private readonly deps: FlowDeps) {}

  /** "Allow camera": opens the camera, then shooting (or noCamera). */
  async allowCamera(): Promise<void> {
    const { store } = this.deps;
    if (store.get().screen !== 'cameraAccess') return;
    this.stream = await enableCamera({
      store,
      video: this.deps.video,
      devices: this.deps.devices,
    });
    if (this.stream) this.ensureUploader();
  }

  /** Shutter: capture now, then hand the frame to the uploader. */
  shoot(): ShootResult {
    const { store } = this.deps;
    const uploader = this.uploader;
    if (store.get().screen !== 'shooting' || !uploader) return 'stopped';
    if (!store.get().online) return 'offline';
    if (uploader.stopReason !== null) return 'stopped';
    if (!uploader.canShoot) return 'full';
    let frame;
    try {
      frame = captureFrame(this.deps.video, this.deps.createCanvas);
    } catch {
      return 'error';
    }
    return uploader.add(frame);
  }

  /** Finish: stop shooting, wait for every photo, finish the session now, then thanks. */
  async finishTapped(): Promise<void> {
    if (this.deps.store.get().screen !== 'shooting') return;
    await this.wrapUp(true);
  }

  /** The server finished the session (idle, grace, or realtime). */
  async sessionFinished(): Promise<void> {
    if (this.isOver()) return;
    await this.wrapUp(false);
  }

  /** The session is gone (revoked, expired, closed): stop everything. */
  sessionEnded(): void {
    if (this.deps.store.get().screen === 'ended') return;
    this.uploader?.end();
    this.close('ended');
  }

  setOnline(online: boolean): void {
    this.deps.store.set({ online });
  }

  /** The page was hidden: release the camera (browsers pause or end it anyway). */
  pauseCamera(): void {
    stopCamera(this.stream);
    this.stream = null;
  }

  /** The page is visible again while shooting: open the camera again (or noCamera). */
  async resumeCamera(): Promise<void> {
    if (this.deps.store.get().screen !== 'shooting' || this.stream) return;
    this.stream = await enableCamera({
      store: this.deps.store,
      video: this.deps.video,
      devices: this.deps.devices,
    });
  }

  private ensureUploader(): Uploader {
    if (this.uploader) return this.uploader;
    const session = this.deps.store.get().session;
    if (!session) throw new Error('No session');
    this.uploader = new Uploader({
      api: this.deps.api,
      session,
      ...this.deps.uploader,
      onChange: (uploads) => {
        this.deps.store.set({ uploads });
      },
      onStop: (reason) => {
        this.onUploaderStop(reason);
      },
    });
    return this.uploader;
  }

  private onUploaderStop(reason: StopReason): void {
    if (reason === 'gone') this.sessionEnded();
    else void this.sessionFinished();
  }

  private async wrapUp(callFinish: boolean): Promise<void> {
    if (this.wrapping) return;
    this.wrapping = true;
    const { store, api } = this.deps;
    stopCamera(this.stream);
    this.stream = null;
    const uploader = this.uploader;
    if (uploader && uploader.counts.inFlight > 0) {
      store.set({ screen: 'sending' });
      await uploader.whenIdle();
    }
    if (this.isOver()) return;
    const session = store.get().session;
    if (callFinish && session) {
      // Errors do not matter here: finished or gone means it is over anyway, and without an answer
      // the server finishes an idle session after 2 minutes.
      await api.finish(session.sessionId, session.token).catch(() => undefined);
    }
    uploader?.finish();
    this.close('thanks');
  }

  private isOver(): boolean {
    const screen = this.deps.store.get().screen;
    return screen === 'thanks' || screen === 'ended';
  }

  private close(screen: 'thanks' | 'ended'): void {
    stopCamera(this.stream);
    this.stream = null;
    const session = this.deps.store.get().session;
    if (session) this.deps.tokens.clear(session.sessionId);
    this.deps.store.set({ screen });
  }
}
