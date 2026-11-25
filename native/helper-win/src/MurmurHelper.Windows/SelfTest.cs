namespace Murmur.Helper.Windows;

/// <summary>
/// <c>murmur-helper.exe --self-test</c>: runs the real Win32 backends once and says what worked.
/// It is how the Windows code is checked on a Windows machine (CI runs it) without a person at the
/// keyboard. It reads and writes only a throwaway Credential Manager item and the clipboard.
/// </summary>
public static class SelfTest
{
    public static int Run(TextWriter output)
    {
        var failures = 0;
        void Check(string name, Func<string?> body)
        {
            try
            {
                var detail = body();
                output.WriteLine($"ok   {name}{(detail is null ? "" : ": " + detail)}");
            }
            catch (Exception error)
            {
                failures++;
                output.WriteLine($"FAIL {name}: {error.GetType().Name}: {error.Message}");
            }
        }

        var permissions = new WindowsPermissions();
        Check("permissions", () =>
        {
            var seen = Router.PermissionKinds.Select(kind => $"{kind}={permissions.Status(kind)}").ToList();
            foreach (var kind in Router.PermissionKinds)
            {
                if (permissions.Status(kind) is not ("granted" or "denied" or "not_determined" or "unknown"))
                    throw new InvalidOperationException($"{kind} gave an unknown status");
            }
            return string.Join(" ", seen);
        });

        Check("secure store round trip", () =>
        {
            var store = new WindowsSecureStore();
            var service = "murmur-selftest-" + Guid.NewGuid().ToString("N")[..8];
            if (store.Get(service, "token") is not null) throw new InvalidOperationException("an unset item was found");
            store.Set(service, "token", "s3cret ✓");
            if (store.Get(service, "token") != "s3cret ✓") throw new InvalidOperationException("the value did not come back");
            if (store.Get(service, "other") is not null) throw new InvalidOperationException("another account was found");
            if (!store.Delete(service, "token")) throw new InvalidOperationException("delete said nothing was there");
            if (store.Delete(service, "token")) throw new InvalidOperationException("a second delete found it");
            return null;
        });

        Check("front window and window list", () =>
        {
            var front = Windows.Front();
            var windows = Windows.VisibleWindows().ToList();
            return $"front={(front?.ProcessName ?? "none")}, {windows.Count} windows";
        });

        Check("clipboard copy", () =>
        {
            new WindowsInsertion().Copy("murmur self test");
            return null;
        });

        Check("keyboard hook starts and stops", () =>
        {
            using var hook = new WindowsKeyboardHook((_, _) => { });
            hook.Listen(true);
            hook.Listen(false);
            return null;
        });

        Check("audio devices", () =>
        {
            var devices = new WindowsAudio().Devices();
            return $"{devices.Count} input devices";
        });

        Check("output mute reads", () => $"muted={new WindowsOutputMute().Muted?.ToString() ?? "no switch"}");

        // The speech check needs a model folder, so it runs only when one is named (CI downloads a small one).
        var speechModel = Environment.GetEnvironmentVariable("MURMUR_SELFTEST_SPEECH_MODEL");
        if (!string.IsNullOrEmpty(speechModel))
        {
            Check("speech: synthesise a sentence and transcribe it", () => SpeechCheck(speechModel));
        }
        else
        {
            output.WriteLine("skip speech: set MURMUR_SELFTEST_SPEECH_MODEL to a folder holding a ggml model");
        }

        output.WriteLine(failures == 0 ? "self-test passed" : $"self-test failed ({failures})");
        return failures == 0 ? 0 : 1;
    }

    /// <summary>Has Windows speak a sentence into a WAV file, then runs the same controller the helper uses on it.</summary>
    private static string SpeechCheck(string modelDir)
    {
        var path = Path.Combine(Path.GetTempPath(), "murmur-selftest-" + Guid.NewGuid().ToString("N")[..8] + ".wav");
        try
        {
            using (var voice = new System.Speech.Synthesis.SpeechSynthesizer())
            {
                voice.SetOutputToWaveFile(path, new System.Speech.AudioFormat.SpeechAudioFormatInfo(
                    16000, System.Speech.AudioFormat.AudioBitsPerSample.Sixteen, System.Speech.AudioFormat.AudioChannel.Mono));
                voice.Speak("Hello, this is a test of the speech engine.");
            }
            var engine = new WhisperEngine();
            var controller = new SpeechController(engine);
            var loaded = controller.Load(new System.Text.Json.Nodes.JsonObject
            {
                ["model"] = "selftest", ["modelDir"] = modelDir, ["tokenizerDir"] = modelDir,
            });
            var done = controller.File(new System.Text.Json.Nodes.JsonObject
            {
                ["path"] = path,
                ["languages"] = new System.Text.Json.Nodes.JsonArray("en"),
            });
            controller.Shutdown();
            var text = done["text"]!.GetValue<string>().ToLowerInvariant();
            if (!text.Contains("hello") || !text.Contains("test"))
                throw new InvalidOperationException($"unexpected transcript: \"{text}\"");
            return $"loaded in {loaded["loadMs"]} ms, decoded in {done["decodeMs"]} ms, {done["segments"]!.AsArray().Count} segment(s)";
        }
        finally
        {
            try { File.Delete(path); } catch { /* temp file */ }
        }
    }
}
