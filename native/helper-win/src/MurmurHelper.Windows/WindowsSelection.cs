using System.Runtime.InteropServices;
using Interop.UIAutomationClient;

namespace Murmur.Helper.Windows;

/// <summary>The selection through UI Automation, and the clipboard copy it falls back to.</summary>
public sealed class WindowsSelection(WindowsKeys keys) : ISelectionPlatform
{
    public FocusedSelection Read(int maxLength)
    {
        try
        {
            var element = Automation.Client.GetFocusedElement();
            return element is null ? new FocusedSelection(SelectionKind.NoFocus) : ReadElement(element, maxLength);
        }
        catch (COMException)
        {
            // The app went away, did not answer in time, or has no accessibility support.
            return new FocusedSelection(SelectionKind.Unsupported);
        }
    }

    internal static FocusedSelection ReadElement(IUIAutomationElement element, int maxLength)
    {
        // Checked before anything else is read: a password field's text is never asked for.
        if (element.CurrentIsPassword != 0) return new FocusedSelection(SelectionKind.Secure);
        if (element.GetCurrentPattern(UIA_PatternIds.UIA_TextPatternId) is not IUIAutomationTextPattern pattern)
            return new FocusedSelection(SelectionKind.Unsupported);
        if (pattern.SupportedTextSelection == SupportedTextSelection.SupportedTextSelection_None)
            return new FocusedSelection(SelectionKind.Unsupported);
        var ranges = pattern.GetSelection();
        if (ranges is null || ranges.Length == 0) return new FocusedSelection(SelectionKind.Unsupported);
        var range = ranges.GetElement(0);
        // A few more than the limit, so "too long" is known without copying a whole document.
        var text = range.GetText(maxLength + 2) ?? "";
        return new FocusedSelection(SelectionKind.Selected, text, Offset(pattern, range), text.Length);
    }

    /// <summary>Where the selection starts, in the field's characters with a line end counted once.</summary>
    private static int? Offset(IUIAutomationTextPattern pattern, IUIAutomationTextRange selection)
    {
        const int limit = 200_000;
        try
        {
            var before = pattern.DocumentRange.Clone();
            before.MoveEndpointByRange(TextPatternRangeEndpoint.TextPatternRangeEndpoint_End, selection, TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start);
            var text = before.GetText(limit) ?? "";
            return text.Length >= limit ? null : text.Replace("\r\n", "\n").Length;
        }
        catch (COMException) { return null; }
    }

    public string? FrontProcessName() => keys.FrontProcessName();

    public uint ClipboardSequence => Native.GetClipboardSequenceNumber();

    public object? SaveClipboard()
    {
        var snapshot = WindowsClipboard.Snapshot();
        // Over the size limit nothing was kept, so putting "it" back would empty the clipboard.
        return snapshot is null || (!snapshot.Complete && snapshot.Items.Count == 0) ? null : snapshot;
    }

    public string? ReadClipboardText() => WindowsClipboard.Snapshot()?.Text;

    public void RestoreClipboard(object saved) => WindowsClipboard.Restore((ClipboardSnapshot)saved);

    public bool PressCopy() => keys.Press(new KeyStroke(KeyCombos.Insert, Control: true));
}

/// <summary>The UI Automation client, with a short time limit so a hung app cannot hang Murmur.</summary>
internal static class Automation
{
    private static readonly Lazy<IUIAutomation> Instance = new(() =>
    {
        var client = new CUIAutomation8Class();
        if (client is IUIAutomation2 timed)
        {
            timed.ConnectionTimeout = 1000;
            timed.TransactionTimeout = 1000;
        }
        return client;
    });

    public static IUIAutomation Client => Instance.Value;
}
