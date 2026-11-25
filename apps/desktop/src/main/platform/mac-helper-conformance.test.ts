import {
  PROTOCOL_VERSION,
  type Envelope,
  type HotkeyBinding,
  type PermissionKind,
} from "@murmur/shared";
import { FakeHelperProcess, createTestLogger, flush } from "../helper/fakes";
import type { ExitInfo, SpawnHelper } from "../helper/types";
import { createMacHelper } from "./mac-helper";
import { describePlatformHelperConformance, type HelperWorld } from "./platform-helper-conformance";

/**
 * The operating system and the Mac helper's side of the protocol, played by a script. Main
 * talks to it exactly as it talks to the real helper over its pipes, so this checks main's
 * half of the contract (the requests it sends, the replies and events it accepts). The real
 * Mac helper runs the same scenarios on the owner's Mac with `npm run smoke`.
 */
class ScriptedMacHelper extends FakeHelperProcess {
  permissions: Record<PermissionKind, string> = {
    microphone: "not_determined",
    accessibility: "granted",
    inputMonitoring: "granted",
    screenRecording: "granted",
  };
  bindings: HotkeyBinding[] = [];
  field = "";
  fieldFocused = false;
  front: { bundleId: string; name: string } | null = null;
  watchingFront = false;
  watchingCalls = false;
  secrets = new Map<string, string>();
  audioSession: string | null = null;
  meeting: string | null = null;
  modelLoaded = false;
  private readonly startedAt = Date.now();

  override write(data: string): void {
    const before = this.received.length;
    super.write(data);
    for (const request of this.received.slice(before)) {
      queueMicrotask(() => this.handle(request));
    }
  }

  override exit(info: ExitInfo = { code: 1, signal: null }): void {
    super.exit(info);
  }

  private ok(request: Envelope, result: Record<string, unknown> = {}): void {
    this.respondOk(request, result);
  }

  private handle(request: Envelope): void {
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    const key = `${String(payload.service)}\u0000${String(payload.account)}`;
    switch (request.type) {
      case "hello.ack":
        return this.ok(request, { ready: true });
      case "ping":
        return this.ok(request, { uptimeMs: Date.now() - this.startedAt });
      case "shutdown":
        this.ok(request);
        queueMicrotask(() => this.exit({ code: 0, signal: null }));
        return;
      case "permissions.status":
        return this.ok(request, { ...this.permissions });
      case "permissions.request": {
        const kind = payload.kind as PermissionKind;
        if (this.permissions[kind] === "not_determined") this.permissions[kind] = "granted";
        return this.ok(request, { status: this.permissions[kind], openedSettings: false });
      }
      case "hotkey.configure": {
        this.bindings = payload.bindings as HotkeyBinding[];
        return this.ok(request, { registered: this.bindings.map((b) => b.id), rejected: [] });
      }
      case "insert.text":
        if (this.permissions.accessibility !== "granted") {
          return this.respondError(request, "PERMISSION_DENIED", "Accessibility is off");
        }
        this.field += String(payload.text);
        return this.ok(request, {
          method: "paste_cmd_v",
          delivered: true,
          clipboardRestored: true,
        });
      case "insert.copy":
        return this.ok(request);
      case "keychain.get": {
        const value = this.secrets.get(key);
        return this.ok(request, { found: value !== undefined, value: value ?? "" });
      }
      case "keychain.set":
        this.secrets.set(key, String(payload.value));
        return this.ok(request, { ok: true });
      case "keychain.delete":
        return this.ok(request, { deleted: this.secrets.delete(key) });
      case "focus.watch":
        this.watchingFront = payload.enabled === true;
        this.ok(request, { watching: this.watchingFront });
        if (this.watchingFront && this.front) this.announceFront();
        return;
      case "detect.subscribe":
        this.watchingCalls = payload.enabled === true;
        return this.ok(request, { watching: this.watchingCalls });
      case "audio.start":
        if (this.audioSession !== null) return this.respondError(request, "BUSY", "In use");
        this.audioSession = String(payload.sessionId);
        return this.ok(request, {
          startedAt: Date.now(),
          sampleRate: 16000,
          channels: 1,
          deviceName: "Test microphone",
        });
      case "audio.stop":
        this.audioSession = null;
        return this.ok(request, {
          durationMs: 1000,
          samples: 16000,
          peakDb: -10,
          meanDb: -30,
          silent: false,
          audioFile: { path: "/tmp/dictation.wav", codec: "pcm_s16le", bytes: 32000 },
        });
      case "audio.cancel":
        this.audioSession = null;
        return this.ok(request, { discarded: true });
      case "transcribe.load":
        this.modelLoaded = true;
        return this.ok(request, {
          loadedModel: String(payload.model),
          loadMs: 5,
          computeUnits: "test",
        });
      case "transcribe.unload":
        this.modelLoaded = false;
        return this.ok(request);
      case "transcribe.file":
        if (!this.modelLoaded) return this.respondError(request, "MODEL_NOT_LOADED", "No model");
        if (String(payload.path).endsWith("missing.wav")) {
          return this.respondError(request, "NOT_FOUND", "No such file");
        }
        return this.ok(request, {
          text: "a scripted transcript",
          language: "en",
          segments: [{ startMs: 0, endMs: 1000, text: "a scripted transcript", confidence: 0.9 }],
          decodeMs: 10,
          audioMs: 1000,
        });
      case "transcribe.live":
        if (this.meeting !== String(payload.meetingId)) {
          return this.respondError(request, "NOT_FOUND", "This channel is not being recorded");
        }
        return this.ok(request, {
          text: "",
          language: "",
          segments: [],
          decodeMs: 0,
          audioMs: 500,
          channel: String(payload.channel),
          seq: 1,
          startMs: 0,
        });
      case "capture.start":
        this.meeting = String(payload.meetingId);
        return this.ok(request, {
          startedAt: Date.now(),
          channels: { mic: "Test microphone", system: "Test output" },
          sampleRate: 16000,
          warnings: [],
        });
      case "capture.stop": {
        const meetingId = String(payload.meetingId);
        for (const channel of ["mic", "system"] as const) {
          this.send({
            id: null,
            type: "capture.chunk",
            payload: {
              meetingId,
              channel,
              seq: 1,
              path: `/tmp/${meetingId}/${channel}-1.wav`,
              sha256: "a".repeat(64),
              bytes: 1024,
              startMs: 0,
              durationMs: 1000,
            },
          });
        }
        this.meeting = null;
        return this.ok(request, {
          durationMs: 1000,
          channels: {
            mic: { chunks: 1, durationMs: 1000 },
            system: { chunks: 1, durationMs: 1000 },
          },
        });
      }
      default:
        return this.respondError(request, "UNSUPPORTED_REQUEST", request.type);
    }
  }

  announceFront(): void {
    if (!this.front) return;
    this.send({
      id: null,
      type: "focus.app",
      payload: { bundleId: this.front.bundleId, name: this.front.name, pid: 100 },
    });
  }
}

const HOLD: HotkeyBinding = {
  id: "dictate",
  action: "dictate.hold",
  trigger: { type: "key", keyCode: 63, modifiers: [] },
  mode: "hold",
};

describePlatformHelperConformance("Mac helper, scripted", {
  async start(): Promise<HelperWorld> {
    const script = new ScriptedMacHelper();
    const spawn: SpawnHelper = () => {
      queueMicrotask(() => script.sendHello());
      return script;
    };
    const helper = createMacHelper({
      isPackaged: false,
      resourcesPath: "/App/Contents/Resources",
      appPath: "/repo/apps/desktop",
      env: {},
      appVersion: "1.0.0",
      exists: () => true,
      spawn,
      logger: createTestLogger(),
    });
    return {
      helper,
      holdBinding: HOLD,
      captureFolder: "/tmp/murmur-conformance",
      speechModelDir: "/tmp/murmur-conformance-model",
      async setPermission(kind, status) {
        script.permissions[kind] = status;
      },
      async keys(binding, phase) {
        const live = script.bindings.find((b) => b.id === binding.id);
        if (!live) return;
        script.send({
          id: null,
          type: "hotkey.event",
          payload: { bindingId: live.id, action: live.action, state: phase, at: Date.now() },
        });
        await flush();
      },
      async focusTextField() {
        script.field = "";
        script.fieldFocused = true;
      },
      async textFieldValue() {
        return script.field;
      },
      async focusApp(app) {
        script.front = app;
        if (script.watchingFront) script.announceFront();
        await flush();
      },
      async setCall(matcherId, active) {
        if (!script.watchingCalls) return;
        script.send({ id: null, type: "detect.event", payload: { matcherId, active } });
        await flush();
      },
      async close() {
        helper.terminate();
      },
    };
  },
});

// Keeps the version the script announces in step with the protocol the app speaks.
void PROTOCOL_VERSION;
