import {
  PROTOCOL_VERSION,
  type AudioDevice,
  type AudioLevel,
  type AudioSilent,
  type AudioDevicesChanged,
  type AudioRouteChanged,
  type AudioStartInput,
  type AudioStartResult,
  type AudioStopResult,
  isSupportedProtocolVersion,
  type HelloPayload,
  isRequestablePermissionKind,
  type HelperEventMessage,
  type HelperStatus,
  type HotkeyBinding,
  type HotkeyConfigureResult,
  type HotkeyEvent,
  type HotkeyTapStatus,
  type ContextSnapshotInput,
  type FocusContext,
  type TypingActivity,
  type EditsChanged,
  type EditsWatchInput,
  type MediaPlayback,
  type InsertTextInput,
  type InsertTextResult,
  type PermissionKind,
  type PermissionRequestResult,
  type PermissionSnapshot,
  type PlatformHelper,
  type SpeechModelLoadInput,
  type SpeechModelLoadResult,
  type TranscribeFileInput,
  type Transcript,
  type Unsubscribe,
} from "@murmur/shared";
import { DEFAULT_REQUEST_TIMEOUT_MS, HelperConnection } from "./connection";
import {
  HelperError,
  type Clock,
  type ExitInfo,
  type Logger,
  type SpawnHelper,
  type TimerHandle,
} from "./types";

function subscribe<T>(handlers: Set<(value: T) => void>, handler: (value: T) => void): Unsubscribe {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** The first load compiles the model for the Neural Engine, which can take minutes. */
export const SPEECH_LOAD_TIMEOUT_MS = 10 * 60_000;
/** The helper applies its own decode timeout; this only catches a helper that went quiet. */
export const TRANSCRIBE_TIMEOUT_MS = 2 * 60_000;

/** Where the helper binary is, or why there is none. */
export type HelperBinary = { path: string } | { path: null; message: string };

export interface SupervisorOptions {
  binary: HelperBinary;
  appVersion: string;
  spawn: SpawnHelper;
  clock: Clock;
  logger: Logger;
  requestTimeoutMs?: number;
  helloTimeoutMs?: number;
  pingIntervalMs?: number;
  maxMissedPings?: number;
  /** Delay before restart n (0-based), clamped to the last entry. */
  backoffMs?: readonly number[];
  restartLimit?: number;
  restartWindowMs?: number;
  /** How long shutdown waits for the helper to exit before killing it. */
  shutdownGraceMs?: number;
}

/**
 * Runs the helper under supervision: handshake, liveness pings, restart with backoff,
 * and a restart budget. Process spawning and time are injected so the whole policy can
 * be tested with a fake helper and a fake clock.
 */
export class HelperSupervisor implements PlatformHelper {
  private readonly requestTimeoutMs: number;
  private readonly helloTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly maxMissedPings: number;
  private readonly backoffMs: readonly number[];
  private readonly restartLimit: number;
  private readonly restartWindowMs: number;
  private readonly shutdownGraceMs: number;

  private status: HelperStatus = { state: "stopped", helperVersion: null, message: null };
  private readonly statusHandlers = new Set<(status: HelperStatus) => void>();
  private readonly hotkeyEventHandlers = new Set<(event: HotkeyEvent) => void>();
  private readonly tapStatusHandlers = new Set<(status: HotkeyTapStatus) => void>();
  private readonly audioLevelHandlers = new Set<(level: AudioLevel) => void>();
  private readonly audioSilentHandlers = new Set<(silent: AudioSilent) => void>();
  private readonly devicesChangedHandlers = new Set<(change: AudioDevicesChanged) => void>();
  private readonly routeChangedHandlers = new Set<(change: AudioRouteChanged) => void>();
  private readonly typingHandlers = new Set<(activity: TypingActivity) => void>();
  private readonly editsHandlers = new Set<(change: EditsChanged) => void>();

  private connection: HelperConnection | null = null;
  private restartTimes: number[] = [];
  private restartTimer: TimerHandle | null = null;
  private helloTimer: TimerHandle | null = null;
  private pingTimer: TimerHandle | null = null;
  private graceTimer: TimerHandle | null = null;
  private missedPings = 0;
  private lastExitAt: number | null = null;
  private stopping = false;
  private givenUp = false;
  private startPromise: Promise<HelloPayload> | null = null;
  private firstStart: { resolve(hello: HelloPayload): void; reject(error: Error): void } | null =
    null;
  private onStopped: (() => void) | null = null;

  constructor(private readonly options: SupervisorOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
    this.pingIntervalMs = options.pingIntervalMs ?? 5000;
    this.maxMissedPings = options.maxMissedPings ?? 3;
    this.backoffMs = options.backoffMs ?? [500, 1000, 2000, 4000, 8000];
    this.restartLimit = options.restartLimit ?? 3;
    this.restartWindowMs = options.restartWindowMs ?? 60_000;
    this.shutdownGraceMs = options.shutdownGraceMs ?? 2000;
  }

  // ------------------------------------------------------------ PlatformHelper

  start(): Promise<HelloPayload> {
    if (this.startPromise) return this.startPromise;
    const { binary } = this.options;
    if (binary.path === null) {
      this.options.logger.error(`helper unavailable: ${binary.message}`);
      this.setStatus({ state: "unavailable", helperVersion: null, message: binary.message });
      this.startPromise = Promise.reject(new HelperError("HELPER_UNAVAILABLE", binary.message));
      return this.startPromise;
    }
    this.startPromise = new Promise((resolve, reject) => {
      this.firstStart = { resolve, reject };
    });
    this.launch(binary.path);
    return this.startPromise;
  }

  async shutdown(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.clearTimer("restartTimer");
    this.clearTimer("helloTimer");
    this.clearTimer("pingTimer");
    const connection = this.connection;
    if (!connection) {
      if (this.status.state !== "unavailable" && this.status.state !== "error") {
        this.setStatus({ state: "stopped", helperVersion: null, message: null });
      }
      return;
    }
    const stopped = new Promise<void>((resolve) => {
      this.onStopped = resolve;
    });
    this.graceTimer = this.options.clock.setTimeout(() => {
      this.options.logger.warn("helper did not exit in time, killing it");
      connection.kill("SIGKILL");
    }, this.shutdownGraceMs);
    if (this.status.state === "ready") {
      connection.request("shutdown", { reason }, this.shutdownGraceMs).catch(() => {});
    } else {
      connection.kill("SIGTERM");
    }
    await stopped;
  }

  terminate(): void {
    this.stopping = true;
    this.connection?.kill("SIGKILL");
  }

  ping(): Promise<{ uptimeMs: number }> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("ping", {});
  }

  checkPermissions(): Promise<PermissionSnapshot> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("permissions.status", {});
  }

  requestPermission(kind: PermissionKind): Promise<PermissionRequestResult> {
    if (!isRequestablePermissionKind(kind)) {
      return Promise.reject(new HelperError("INVALID_PAYLOAD", `${kind} cannot be requested`));
    }
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("permissions.request", { kind });
  }

  configureHotkeys(bindings: HotkeyBinding[]): Promise<HotkeyConfigureResult> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("hotkey.configure", { bindings });
  }

  startAudio(input: AudioStartInput): Promise<AudioStartResult> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("audio.start", input);
  }

  async listAudioDevices(): Promise<AudioDevice[]> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    return (await this.connection.request("audio.devices", {})).devices;
  }

  stopAudio(sessionId: string): Promise<AudioStopResult> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("audio.stop", { sessionId });
  }

  cancelAudio(sessionId: string): Promise<{ discarded: boolean }> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("audio.cancel", { sessionId });
  }

  loadSpeechModel(input: SpeechModelLoadInput): Promise<SpeechModelLoadResult> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("transcribe.load", input, SPEECH_LOAD_TIMEOUT_MS);
  }

  async unloadSpeechModel(): Promise<void> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    await this.connection.request("transcribe.unload", {});
  }

  transcribeFile(input: TranscribeFileInput): Promise<Transcript> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("transcribe.file", input, TRANSCRIBE_TIMEOUT_MS);
  }

  insertText(input: InsertTextInput): Promise<InsertTextResult> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("insert.text", input);
  }

  async copyText(text: string): Promise<void> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    await this.connection.request("insert.copy", { text });
  }

  focusContext(input: ContextSnapshotInput = {}): Promise<FocusContext> {
    if (!this.connection || this.status.state !== "ready") {
      return Promise.reject(new HelperError("HELPER_UNAVAILABLE", "The helper is not running"));
    }
    return this.connection.request("context.snapshot", input);
  }

  async getOutputMuted(): Promise<boolean | null> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    return (await this.connection.request("media.status", {})).outputMuted;
  }

  async setOutputMuted(muted: boolean): Promise<boolean> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    return (await this.connection.request("media.mute", { muted })).previousMuted;
  }

  onAudioLevel(handler: (level: AudioLevel) => void): Unsubscribe {
    return subscribe(this.audioLevelHandlers, handler);
  }

  onAudioSilent(handler: (silent: AudioSilent) => void): Unsubscribe {
    return subscribe(this.audioSilentHandlers, handler);
  }

  onAudioDevicesChanged(handler: (change: AudioDevicesChanged) => void): Unsubscribe {
    return subscribe(this.devicesChangedHandlers, handler);
  }

  onAudioRouteChanged(handler: (change: AudioRouteChanged) => void): Unsubscribe {
    return subscribe(this.routeChangedHandlers, handler);
  }

  onTypingActivity(handler: (activity: TypingActivity) => void): Unsubscribe {
    return subscribe(this.typingHandlers, handler);
  }

  async getPlayback(): Promise<MediaPlayback> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    return this.connection.request("media.playback", {});
  }

  async pauseMedia(): Promise<boolean> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    return (await this.connection.request("media.pause", {})).paused;
  }

  async resumeMedia(): Promise<boolean> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    return (await this.connection.request("media.resume", {})).resumed;
  }

  async watchEdits(input: EditsWatchInput): Promise<boolean> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    return (await this.connection.request("edits.watch", input)).watching;
  }

  async cancelEdits(): Promise<void> {
    if (!this.connection || this.status.state !== "ready") return;
    await this.connection.request("edits.cancel", {});
  }

  onEditsChanged(handler: (change: EditsChanged) => void): Unsubscribe {
    return subscribe(this.editsHandlers, handler);
  }

  async watchTyping(enabled: boolean): Promise<void> {
    if (!this.connection || this.status.state !== "ready") {
      throw new HelperError("HELPER_UNAVAILABLE", "The helper is not running");
    }
    await this.connection.request("typing.watch", { enabled });
  }

  onHotkeyEvent(handler: (event: HotkeyEvent) => void): Unsubscribe {
    return subscribe(this.hotkeyEventHandlers, handler);
  }

  onHotkeyTapStatus(handler: (status: HotkeyTapStatus) => void): Unsubscribe {
    return subscribe(this.tapStatusHandlers, handler);
  }

  getStatus(): HelperStatus {
    return this.status;
  }

  onStatusChange(handler: (status: HelperStatus) => void): Unsubscribe {
    return subscribe(this.statusHandlers, handler);
  }

  // ------------------------------------------------------------------ lifecycle

  private launch(binaryPath: string): void {
    const { clock, logger } = this.options;
    this.setStatus({
      state: "starting",
      helperVersion: null,
      message: this.restartTimes.length > 0 ? "Restarting the helper" : null,
    });
    const spawnedAt = clock.now();
    logger.info(`starting helper: ${binaryPath}`);

    let connection: HelperConnection;
    try {
      connection = new HelperConnection(this.options.spawn(binaryPath), {
        clock,
        logger,
        requestTimeoutMs: this.requestTimeoutMs,
      });
    } catch (error) {
      logger.error(`could not start helper: ${String(error)}`);
      this.scheduleRestart(binaryPath);
      return;
    }
    this.connection = connection;
    this.missedPings = 0;
    connection.onExit((info) => this.handleExit(connection, binaryPath, info));
    connection.onHello((hello) => void this.handshake(connection, hello, spawnedAt));
    connection.onEvent((event) => {
      if (connection === this.connection) this.dispatchEvent(event);
    });
    this.helloTimer = clock.setTimeout(() => {
      this.helloTimer = null;
      logger.error(`helper sent no hello within ${this.helloTimeoutMs} ms, killing it`);
      connection.kill("SIGKILL");
    }, this.helloTimeoutMs);
  }

  private async handshake(
    connection: HelperConnection,
    hello: HelloPayload,
    spawnedAt: number,
  ): Promise<void> {
    const { clock, logger, appVersion } = this.options;
    if (connection !== this.connection) return;
    this.clearTimer("helloTimer");

    if (!isSupportedProtocolVersion(hello.protocolVersion)) {
      const message = `Protocol version mismatch: helper ${hello.helperVersion} speaks protocol ${hello.protocolVersion}, this app speaks ${PROTOCOL_VERSION}`;
      logger.error(message);
      this.givenUp = true;
      this.setStatus({ state: "error", helperVersion: hello.helperVersion, message });
      this.firstStart?.reject(new HelperError("PROTOCOL_VERSION_MISMATCH", message));
      this.firstStart = null;
      connection
        .request("hello.ack", {
          accepted: false,
          protocolVersion: PROTOCOL_VERSION,
          appVersion,
          reason: message,
        })
        .catch(() => {});
      connection.kill("SIGTERM");
      return;
    }

    try {
      const ack = await connection.request("hello.ack", {
        accepted: true,
        protocolVersion: PROTOCOL_VERSION,
        appVersion,
      });
      if (!ack.ready) throw new HelperError("INTERNAL", "Helper did not report ready");
    } catch (error) {
      if (connection !== this.connection) return;
      logger.error(`handshake failed: ${error instanceof Error ? error.message : String(error)}`);
      connection.kill("SIGKILL");
      return;
    }
    if (connection !== this.connection || this.stopping) return;

    const now = clock.now();
    logger.info(
      `helper ready: version ${hello.helperVersion}, protocol ${hello.protocolVersion}, pid ${hello.pid ?? "unknown"}, ${now - spawnedAt} ms after spawn`,
    );
    if (this.lastExitAt !== null) {
      logger.info(`helper restarted: ready ${now - this.lastExitAt} ms after the previous exit`);
    }
    this.setStatus({ state: "ready", helperVersion: hello.helperVersion, message: null });
    this.firstStart?.resolve(hello);
    this.firstStart = null;
    this.schedulePing(connection);
  }

  private schedulePing(connection: HelperConnection): void {
    this.pingTimer = this.options.clock.setTimeout(() => {
      this.pingTimer = null;
      connection.request("ping", {}).then(
        () => {
          this.missedPings = 0;
          this.continuePinging(connection);
        },
        (error: unknown) => {
          if (connection !== this.connection) return;
          this.missedPings += 1;
          this.options.logger.warn(
            `ping ${this.missedPings} of ${this.maxMissedPings} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (this.missedPings >= this.maxMissedPings) {
            this.options.logger.error("helper stopped answering pings, killing it");
            connection.kill("SIGKILL");
            return;
          }
          this.continuePinging(connection);
        },
      );
    }, this.pingIntervalMs);
  }

  private continuePinging(connection: HelperConnection): void {
    if (connection === this.connection && !this.stopping) this.schedulePing(connection);
  }

  private handleExit(connection: HelperConnection, binaryPath: string, info: ExitInfo): void {
    if (connection !== this.connection) return;
    const { clock, logger } = this.options;
    this.connection = null;
    this.clearTimer("helloTimer");
    this.clearTimer("pingTimer");
    this.clearTimer("graceTimer");
    connection.close();

    if (this.stopping) {
      logger.info("helper stopped");
      if (this.status.state !== "error") {
        this.setStatus({ state: "stopped", helperVersion: null, message: null });
      }
      this.onStopped?.();
      this.onStopped = null;
      return;
    }
    if (this.givenUp) return;

    const detail = info.error ?? `code ${info.code ?? "none"}, signal ${info.signal ?? "none"}`;
    logger.warn(`helper exited unexpectedly (${detail})`);
    this.lastExitAt = clock.now();
    this.scheduleRestart(binaryPath);
  }

  private scheduleRestart(binaryPath: string): void {
    const { clock, logger } = this.options;
    const now = clock.now();
    this.restartTimes = this.restartTimes.filter((time) => now - time < this.restartWindowMs);
    if (this.restartTimes.length >= this.restartLimit) {
      const message = `The helper stopped after ${this.restartLimit} restarts in ${this.restartWindowMs / 1000} seconds. Restart Murmur to try again.`;
      logger.error(`giving up: ${message}`);
      this.givenUp = true;
      this.setStatus({ state: "error", helperVersion: null, message });
      this.firstStart?.reject(new HelperError("HELPER_UNAVAILABLE", message));
      this.firstStart = null;
      return;
    }
    const delay =
      this.backoffMs[Math.min(this.restartTimes.length, this.backoffMs.length - 1)] ?? 1000;
    this.restartTimes.push(now);
    logger.info(`restart ${this.restartTimes.length} of ${this.restartLimit} in ${delay} ms`);
    this.setStatus({
      state: "starting",
      helperVersion: null,
      message: `Restarting the helper (attempt ${this.restartTimes.length} of ${this.restartLimit})`,
    });
    this.restartTimer = clock.setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.launch(binaryPath);
    }, delay);
  }

  // -------------------------------------------------------------------- helpers

  private dispatchEvent(event: HelperEventMessage): void {
    switch (event.type) {
      case "hotkey.event":
        for (const handler of this.hotkeyEventHandlers) handler(event.payload);
        break;
      case "hotkey.tap.status":
        for (const handler of this.tapStatusHandlers) handler(event.payload);
        break;
      case "audio.level":
        for (const handler of this.audioLevelHandlers) handler(event.payload);
        break;
      case "audio.silent":
        for (const handler of this.audioSilentHandlers) handler(event.payload);
        break;
      case "audio.devices.changed":
        for (const handler of this.devicesChangedHandlers) handler(event.payload);
        break;
      case "audio.route.changed":
        for (const handler of this.routeChangedHandlers) handler(event.payload);
        break;
      case "typing.activity":
        for (const handler of this.typingHandlers) handler(event.payload);
        break;
      case "edits.changed":
        for (const handler of this.editsHandlers) handler(event.payload);
        break;
    }
  }

  private clearTimer(name: "restartTimer" | "helloTimer" | "pingTimer" | "graceTimer"): void {
    const handle = this[name];
    if (handle !== null) this.options.clock.clearTimeout(handle);
    this[name] = null;
  }

  private setStatus(next: HelperStatus): void {
    const previous = this.status;
    if (
      previous.state === next.state &&
      previous.helperVersion === next.helperVersion &&
      previous.message === next.message
    ) {
      return;
    }
    this.status = next;
    for (const handler of this.statusHandlers) handler(next);
  }
}
