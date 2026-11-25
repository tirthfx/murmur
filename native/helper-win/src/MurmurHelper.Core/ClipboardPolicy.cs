namespace Murmur.Helper;

/// <summary>
/// Which clipboard formats can be saved and put back, as plain data so it is tested on any machine.
/// A format whose data is a block of global memory (text, HTML, file lists, device-independent
/// bitmaps, anything an app registered) can be copied byte for byte. A format whose data is a GDI
/// handle, or that an app keeps private, cannot.
/// </summary>
public static class ClipboardPolicy
{
    public const uint CfBitmap = 2, CfMetafilePict = 3, CfPalette = 9, CfEnhMetafile = 14, CfDib = 8, CfDibV5 = 17;
    public const uint CfOwnerDisplay = 0x80;
    public const uint CfDspFirst = 0x81, CfDspLast = 0x8E;
    public const uint CfPrivateFirst = 0x200, CfPrivateLast = 0x2FF, CfGdiObjFirst = 0x300, CfGdiObjLast = 0x3FF;

    /// <summary>The most clipboard data that is kept while a paste is in progress.</summary>
    public const long MaxBytes = 64L * 1024 * 1024;

    /// <summary>True when the format's data is global memory that can be copied.</summary>
    public static bool IsCopyable(uint format) =>
        format is not (CfBitmap or CfMetafilePict or CfPalette or CfEnhMetafile or CfOwnerDisplay)
        && !(format is >= CfDspFirst and <= CfDspLast)
        && !(format is >= CfPrivateFirst and <= CfPrivateLast)
        && !(format is >= CfGdiObjFirst and <= CfGdiObjLast);

    /// <summary>
    /// The formats a clipboard holds that cannot be copied and that Windows will not rebuild from a
    /// copied one: a bitmap or palette comes back from a saved DIB, and the two metafile kinds come
    /// from each other. What is left is lost when the clipboard is emptied.
    /// </summary>
    public static IReadOnlyList<uint> Lost(IEnumerable<uint> present)
    {
        var all = present.ToHashSet();
        var lost = new List<uint>();
        foreach (var format in all)
        {
            if (IsCopyable(format)) continue;
            var rebuilt = format switch
            {
                CfBitmap or CfPalette => all.Contains(CfDib) || all.Contains(CfDibV5),
                // One metafile kind is rebuilt from the other only if it can be copied; neither can.
                _ => false,
            };
            if (!rebuilt) lost.Add(format);
        }
        lost.Sort();
        return lost;
    }
}
