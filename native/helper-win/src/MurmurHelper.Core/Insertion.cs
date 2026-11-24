using System.Text;
using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>
/// The rules for putting text into the focused field. The OS calls are behind
/// <see cref="IInsertionPlatform"/>. App lists name process images on Windows (<c>putty.exe</c>).
/// </summary>
public sealed class InsertionController(IInsertionPlatform platform)
{
    public static readonly string[] Methods = { "auto", "paste_cmd_v", "keystrokes" };

    public static InsertRequest Parse(JsonObject p)
    {
        var method = Payload.Str(p, "method");
        if (!Methods.Contains(method)) throw new HelperException(ErrorCode.InvalidPayload, "method is auto, paste_cmd_v or keystrokes");
        var delay = Payload.Int(p, "restoreDelayMs");
        if (delay is < 0 or > 2000) throw new HelperException(ErrorCode.InvalidPayload, "restoreDelayMs is 0 to 2000");
        return new InsertRequest(
            Payload.Str(p, "text"), method, Payload.Bool(p, "restoreClipboard"), delay,
            Payload.TryBool(p, "pressEnter") ?? false,
            Payload.Strings(p, "typeInApps"), Payload.Strings(p, "trimTrailingNewlinesInApps"),
            Payload.TryStr(p, "html"));
    }

    public JsonObject Insert(InsertRequest request)
    {
        var app = platform.FrontProcessName();
        bool InList(IReadOnlyList<string> list) =>
            app is not null && list.Any(item => string.Equals(item, app, StringComparison.OrdinalIgnoreCase));

        var text = InList(request.TrimTrailingNewlinesInApps) ? request.Text.TrimEnd('\r', '\n') : request.Text;
        var typed = request.Method == "keystrokes" || (request.Method == "auto" && InList(request.TypeInApps));
        bool? restored;
        try
        {
            if (typed)
            {
                platform.Type(text);
                restored = null;
            }
            else
            {
                // Rich text goes beside the plain text, but not into an app that trims newlines.
                var html = InList(request.TrimTrailingNewlinesInApps) ? null : request.Html;
                restored = platform.Paste(text, html, request.RestoreClipboard, request.RestoreDelayMs);
            }
        }
        catch (HelperException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new HelperException(ErrorCode.PasteFailed, error.Message);
        }

        bool? enterPressed = null;
        if (request.PressEnter)
        {
            // Return goes only to the app the text went to.
            enterPressed = string.Equals(platform.FrontProcessName(), app, StringComparison.OrdinalIgnoreCase);
            if (enterPressed == true) platform.PressEnter();
        }
        return new JsonObject
        {
            ["method"] = typed ? "keystrokes" : "paste_cmd_v",
            ["delivered"] = true,
            ["clipboardRestored"] = restored,
            ["appBundleId"] = app,
            ["enterPressed"] = enterPressed,
        };
    }
}

/// <summary>The "HTML Format" clipboard format: a header with byte offsets, then the fragment.</summary>
public static class CfHtml
{
    public static string Build(string fragment)
    {
        const string start = "<html><body><!--StartFragment-->";
        const string end = "<!--EndFragment--></body></html>";
        const string headerTemplate = "Version:0.9\r\nStartHTML:{0:D10}\r\nEndHTML:{1:D10}\r\nStartFragment:{2:D10}\r\nEndFragment:{3:D10}\r\n";
        var headerLength = string.Format(headerTemplate, 0, 0, 0, 0).Length;
        var startHtml = headerLength;
        var startFragment = startHtml + Encoding.UTF8.GetByteCount(start);
        var endFragment = startFragment + Encoding.UTF8.GetByteCount(fragment);
        var endHtml = endFragment + Encoding.UTF8.GetByteCount(end);
        return string.Format(headerTemplate, startHtml, endHtml, startFragment, endFragment) + start + fragment + end;
    }
}
