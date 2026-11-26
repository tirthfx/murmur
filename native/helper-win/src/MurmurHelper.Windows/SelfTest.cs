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
                output.WriteLine(error.ToString());
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

        Check("clipboard keeps every copyable format", () =>
        {
            // Text, HTML, a bitmap (CF_DIB) and a format an app registered, saved, replaced, put back.
            var custom = Native.RegisterClipboardFormat("MurmurSelfTestFormat");
            var dib = new byte[44];
            BitConverter.GetBytes(40).CopyTo(dib, 0); // biSize
            BitConverter.GetBytes(1).CopyTo(dib, 4); // width
            BitConverter.GetBytes(1).CopyTo(dib, 8); // height
            BitConverter.GetBytes((short)1).CopyTo(dib, 12); // planes
            BitConverter.GetBytes((short)24).CopyTo(dib, 14); // bits per pixel
            var blob = new byte[] { 1, 2, 3, 250, 0, 7 };
            WindowsClipboard.WriteText("original text", "<b>original</b>");
            if (!WindowsClipboard.Open()) throw new InvalidOperationException("the clipboard did not open");
            try
            {
                WindowsClipboard.Put(ClipboardPolicy.CfDib, dib);
                WindowsClipboard.Put(custom, blob);
            }
            finally { Native.CloseClipboard(); }
            var saved = WindowsClipboard.Snapshot() ?? throw new InvalidOperationException("no snapshot");
            WindowsClipboard.WriteText("replacement", null);
            if (!WindowsClipboard.Restore(saved)) throw new InvalidOperationException("restore failed");
            var back = WindowsClipboard.Snapshot() ?? throw new InvalidOperationException("no snapshot after restore");
            if (back.Text != "original text") throw new InvalidOperationException($"text came back as \"{back.Text}\"");
            byte[]? Of(uint format) => back.Items.Where(i => i.Format == format).Select(i => i.Data).FirstOrDefault();
            if (Of(custom) is not { } customBack || !customBack.AsSpan(0, blob.Length).SequenceEqual(blob)) throw new InvalidOperationException("the registered format did not come back");
            if (Of(ClipboardPolicy.CfDib) is null) throw new InvalidOperationException("the bitmap did not come back");
            if (Of(WindowsClipboard.HtmlFormat) is null) throw new InvalidOperationException("the HTML did not come back");
            return $"{back.Items.Count} formats, complete={saved.Complete}";
        });

        Check("keyboard and mouse hooks start and stop", () =>
        {
            using var hook = new WindowsInputHook((_, _) => { }, (_, _) => { });
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

        Check("selection through UI Automation", () =>
        {
            using var window = new TestWindow("murmur selects this text");
            window.Select(7, 14);
            var seen = WindowsSelection.ReadElement(Automation.Client.ElementFromHandle(window.Handle), SelectionController.MaxLength);
            if (seen.Kind != SelectionKind.Selected) throw new InvalidOperationException($"the edit box answered {seen.Kind}");
            if (seen.Text != "selects" || seen.Location != 7) throw new InvalidOperationException($"read \"{seen.Text}\" at {seen.Location}");
            return $"\"{seen.Text}\" at {seen.Location}";
        });

        Check("a password field is not read", () =>
        {
            using var window = new TestWindow("hunter2", password: true);
            window.Select(0, 7);
            var seen = WindowsSelection.ReadElement(Automation.Client.ElementFromHandle(window.Handle), SelectionController.MaxLength);
            if (seen.Kind != SelectionKind.Secure || seen.Text is not null) throw new InvalidOperationException($"it answered {seen.Kind}");
            return null;
        });

        Check("context beside the caret, edit watching and the inspector", () =>
        {
            using var window = new TestWindow("before after");
            window.Select(7, 7);
            var element = Automation.Client.ElementFromHandle(window.Handle);
            var field = WindowsFocus.ReadField(element, 1500, 300);
            if (field is not { Editable: true, Secure: false, TextBefore: "before ", TextAfter: "after" })
                throw new InvalidOperationException($"the field read as {field}");
            var near = WindowsFocus.ReadField(element, 3, 2);
            if (near.TextBefore != "re " || near.TextAfter != "af") throw new InvalidOperationException($"the narrow read gave {near}");
            var watched = new WindowsFocus.Watched(element);
            window.SetText("before and after");
            if (watched.Value() != "before and after") throw new InvalidOperationException($"the watched value is \"{watched.Value()}\"");
            var row = new WindowsFocus.Element(element);
            if (row.Secure || !row.Editable || row.Value() != "before and after") throw new InvalidOperationException($"the inspector saw {row.Role}, \"{row.Value()}\"");
            _ = row.Children();
            return $"role={field.Role}";
        });

        Check("a password field gives no context", () =>
        {
            using var window = new TestWindow("hunter2", password: true);
            var element = Automation.Client.ElementFromHandle(window.Handle);
            var field = WindowsFocus.ReadField(element, 1500, 300);
            if (!field.Secure || field.TextBefore.Length + field.TextAfter.Length != 0) throw new InvalidOperationException($"it read as {field}");
            if (!new WindowsFocus.Element(element).Secure) throw new InvalidOperationException("the inspector does not see it as a password field");
            return null;
        });

        // Typing and copying need the test window in front, which a locked or service session refuses.
        Check("keys and the copy fallback in the front window", () =>
        {
            using var window = new TestWindow("press and copy");
            if (!window.Focus()) return "skipped: the test window could not take focus";
            var keys = new WindowsKeys();
            window.Select(0, 0);
            // Shift+End, which every edit box handles (Ctrl+A is left to the app on some).
            if (!keys.Press(KeyCombos.Translate("right", new HashSet<string> { "command", "shift" }))) throw new InvalidOperationException("the keys were refused");
            Thread.Sleep(200);
            var all = window.Selection();
            if (all != (0, 14)) throw new InvalidOperationException($"selecting to the end gave {all}");
            var selection = new WindowsSelection(keys);
            var focused = selection.Read(SelectionController.MaxLength);
            if (focused.Text != "press and copy") throw new InvalidOperationException($"the focused element read {focused.Kind} \"{focused.Text}\"");
            // The copy fallback on its own: the text is copied and the clipboard comes back.
            var insertion = new WindowsInsertion();
            insertion.Copy("kept on the clipboard");
            var answer = new SelectionController(selection).Read(new System.Text.Json.Nodes.JsonObject
            {
                ["clipboardFirstInApps"] = new System.Text.Json.Nodes.JsonArray(keys.FrontProcessName()),
                ["copyWaitMs"] = 1000,
            });
            if (answer["status"]!.GetValue<string>() != "ok" || answer["text"]!.GetValue<string>() != "press and copy" || answer["source"]!.GetValue<string>() != "clipboard")
                throw new InvalidOperationException($"the copy answered {answer.ToJsonString()}");
            if (WindowsClipboard.Snapshot()?.Text != "kept on the clipboard") throw new InvalidOperationException("the clipboard was not put back");
            return "select to the end, focused read and copy";
        });

        Check("processes under the front window", () =>
        {
            var table = new WindowsProcesses();
            var rows = table.Rows();
            if (!rows.Any(r => r.Pid == Environment.ProcessId)) throw new InvalidOperationException("this process is not in the table");
            var line = table.CommandLine(Environment.ProcessId) ?? throw new InvalidOperationException("no command line for this process");
            if (!line.Contains("--self-test")) throw new InvalidOperationException("the command line is not this process's");
            var app = Windows.Front();
            return $"{rows.Count} processes, front={app?.Name ?? "none"}";
        });

        Check("installed apps", () =>
        {
            var apps = AppCatalog.Result(new WindowsInstalledApps().List())["apps"]!.AsArray();
            if (apps.Count == 0) throw new InvalidOperationException("no app was found in the Start menu");
            return $"{apps.Count} apps";
        });

        // The speech check needs a model folder, so it runs only when one is named (CI downloads a small one).
        var speechModel = Environment.GetEnvironmentVariable("MURMUR_SELFTEST_SPEECH_MODEL");
        if (!string.IsNullOrEmpty(speechModel))
        {
            Check("speech: transcribe a known recording", () => SpeechCheck(speechModel, output));
        }
        else
        {
            output.WriteLine("skip speech: set MURMUR_SELFTEST_SPEECH_MODEL to a folder holding a ggml model");
        }

        output.WriteLine(failures == 0 ? "self-test passed" : $"self-test failed ({failures})");
        return failures == 0 ? 0 : 1;
    }

    /// <summary>
    /// Transcribes <c>jfk.wav</c>, a public-domain recording of one sentence that the fetch script puts
    /// beside the test model, with the same controller the helper uses.
    /// </summary>
    private static string SpeechCheck(string modelDir, TextWriter output)
    {
        var path = Path.Combine(modelDir, "jfk.wav");
        if (!File.Exists(path)) throw new FileNotFoundException($"the test recording is missing: {path}");
        output.WriteLine("     " + WhisperEngine.NativeSearchReport());
        var controller = new SpeechController(new WhisperEngine());
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
        if (!text.Contains("ask not") || !text.Contains("country"))
            throw new InvalidOperationException($"unexpected transcript: \"{text}\"");
        return $"loaded in {loaded["loadMs"]} ms, decoded in {done["decodeMs"]} ms, {done["segments"]!.AsArray().Count} segment(s)";
    }
}
