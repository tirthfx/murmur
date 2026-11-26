using System.Runtime.InteropServices;
using Interop.UIAutomationClient;

namespace Murmur.Helper.Windows;

/// <summary>
/// The focused field, the window tree and a browser's page through UI Automation. Nothing here
/// keeps what it reads, and a password field's text is never asked for.
/// </summary>
public sealed class WindowsFocus : IFocusReader, IWatchedFieldSource, IInspectSource, ISiteReader
{
    private const int MaxFieldText = 100_000;
    private const int MaxPageNodes = 400;

    public FrontAppInfo? App() => Windows.Front();

    public string? WindowTitle()
    {
        var hwnd = Native.GetForegroundWindow();
        return hwnd == IntPtr.Zero ? null : Native.TitleOf(hwnd);
    }

    public FocusedField? Field(int maxBefore, int maxAfter)
    {
        try
        {
            var element = Automation.Client.GetFocusedElement();
            return element is null ? null : ReadField(element, maxBefore, maxAfter);
        }
        catch (COMException) { return null; }
    }

    internal static FocusedField ReadField(IUIAutomationElement element, int maxBefore, int maxAfter)
    {
        var role = RoleOf(element);
        if (element.CurrentIsPassword != 0) return new FocusedField(role, true, Secure: true);
        var editable = IsEditable(element);
        if (element.GetCurrentPattern(UIA_PatternIds.UIA_TextPatternId) is IUIAutomationTextPattern text
            && text.GetSelection() is { Length: > 0 } ranges)
        {
            var caret = ranges.GetElement(0);
            // Only the characters beside the caret are asked for, so a long document is not copied.
            var before = Collapsed(caret);
            before.MoveEndpointByUnit(TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start, TextUnit.TextUnit_Character, -maxBefore);
            var after = Collapsed(caret);
            after.MoveEndpointByUnit(TextPatternRangeEndpoint.TextPatternRangeEndpoint_End, TextUnit.TextUnit_Character, maxAfter);
            return new FocusedField(role, editable, false, before.GetText(2 * maxBefore) ?? "", after.GetText(2 * maxAfter) ?? "");
        }
        // Without a text pattern the caret is unknown; the value is taken as ending at it.
        var value = ValueOf(element);
        return new FocusedField(role, editable, false, value is null ? "" : ContextWindow.Before(value, 2 * maxBefore));
    }

    /// <summary>An empty range at the start of another: the caret.</summary>
    private static IUIAutomationTextRange Collapsed(IUIAutomationTextRange range)
    {
        var caret = range.Clone();
        caret.MoveEndpointByRange(TextPatternRangeEndpoint.TextPatternRangeEndpoint_End, range, TextPatternRangeEndpoint.TextPatternRangeEndpoint_Start);
        return caret;
    }

    internal static string? RoleOf(IUIAutomationElement element)
    {
        var type = element.CurrentControlType;
        return type switch
        {
            UIA_ControlTypeIds.UIA_EditControlTypeId => "Edit",
            UIA_ControlTypeIds.UIA_DocumentControlTypeId => "Document",
            UIA_ControlTypeIds.UIA_ComboBoxControlTypeId => "ComboBox",
            UIA_ControlTypeIds.UIA_TextControlTypeId => "Text",
            UIA_ControlTypeIds.UIA_WindowControlTypeId => "Window",
            UIA_ControlTypeIds.UIA_PaneControlTypeId => "Pane",
            UIA_ControlTypeIds.UIA_ButtonControlTypeId => "Button",
            _ => element.CurrentLocalizedControlType,
        };
    }

    internal static bool IsEditable(IUIAutomationElement element)
    {
        if (element.GetCurrentPattern(UIA_PatternIds.UIA_ValuePatternId) is IUIAutomationValuePattern value)
            return value.CurrentIsReadOnly == 0;
        return element.GetCurrentPattern(UIA_PatternIds.UIA_TextPatternId) is IUIAutomationTextPattern text
            && text.DocumentRange.GetAttributeValue(UIA_TextAttributeIds.UIA_IsReadOnlyAttributeId) is false;
    }

    internal static string? ValueOf(IUIAutomationElement element)
    {
        if (element.GetCurrentPattern(UIA_PatternIds.UIA_ValuePatternId) is IUIAutomationValuePattern value)
            return value.CurrentValue;
        return element.GetCurrentPattern(UIA_PatternIds.UIA_TextPatternId) is IUIAutomationTextPattern text
            ? text.DocumentRange.GetText(MaxFieldText)
            : null;
    }

    IWatchedField? IWatchedFieldSource.Focused()
    {
        try
        {
            var element = Automation.Client.GetFocusedElement();
            return element is null || element.CurrentIsPassword != 0 || !IsEditable(element) ? null : new Watched(element);
        }
        catch (COMException) { return null; }
    }

    internal sealed class Watched(IUIAutomationElement element) : IWatchedField
    {
        public string? Value()
        {
            try { return element.CurrentIsPassword != 0 ? null : ValueOf(element); }
            catch (COMException) { return null; }
        }

        public bool IsFocused()
        {
            try { return Automation.Client.CompareElements(Automation.Client.GetFocusedElement(), element) != 0; }
            catch (COMException) { return false; }
        }
    }

    public (FrontAppInfo App, IInspectable Window)? Target()
    {
        var hwnd = Native.GetForegroundWindow();
        var app = Windows.Front();
        if (hwnd == IntPtr.Zero || app is null) return null;
        try { return (app, new Element(Automation.Client.ElementFromHandle(hwnd))); }
        catch (COMException) { return null; }
    }

    /// <summary>One element for the inspector. A part that cannot be read is left empty.</summary>
    internal sealed class Element(IUIAutomationElement element) : IInspectable
    {
        private static T? Try<T>(Func<T?> read)
        {
            try { return read(); }
            catch (COMException) { return default; }
        }

        public string? Role => Try(() => RoleOf(element));
        public string? Title => Try(() => element.CurrentName is { Length: > 0 } name ? name : null);
        public bool Editable => Try(() => IsEditable(element));
        public bool Secure => Try(() => element.CurrentIsPassword != 0);

        public (int Location, int Length)? SelectedRange() => Try<(int, int)?>(() =>
        {
            var seen = WindowsSelection.ReadElement(element, SelectionController.MaxLength);
            return seen is { Kind: SelectionKind.Selected, Location: { } location } ? (location, seen.Length) : null;
        });

        public string? Value() => Try(() => ValueOf(element));

        public IReadOnlyList<IInspectable> Children() => Try<IReadOnlyList<IInspectable>>(() =>
        {
            var walker = Automation.Client.ControlViewWalker;
            var children = new List<IInspectable>();
            for (var child = walker.GetFirstChildElement(element); child is not null && children.Count < InspectController.MaxNodes; child = walker.GetNextSiblingElement(child))
                children.Add(new Element(child));
            return children;
        }) ?? Array.Empty<IInspectable>();
    }

    /// <summary>The address of the first web document under the front window; its content is not walked.</summary>
    public string? PageAddress()
    {
        var hwnd = Native.GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return null;
        try
        {
            var walker = Automation.Client.ControlViewWalker;
            var queue = new Queue<IUIAutomationElement>();
            queue.Enqueue(Automation.Client.ElementFromHandle(hwnd));
            for (var seen = 0; queue.Count > 0 && seen < MaxPageNodes; seen++)
            {
                var element = queue.Dequeue();
                if (element.CurrentControlType == UIA_ControlTypeIds.UIA_DocumentControlTypeId)
                {
                    if (element.GetCurrentPattern(UIA_PatternIds.UIA_ValuePatternId) is IUIAutomationValuePattern address
                        && address.CurrentValue is { Length: > 0 } url) return url;
                    continue;
                }
                for (var child = walker.GetFirstChildElement(element); child is not null && queue.Count < MaxPageNodes; child = walker.GetNextSiblingElement(child))
                    queue.Enqueue(child);
            }
            return null;
        }
        catch (COMException) { return null; }
    }
}
