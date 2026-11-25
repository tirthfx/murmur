using Xunit;

namespace Murmur.Helper.Tests;

public class ClipboardPolicyTests
{
    [Theory]
    [InlineData(1u)]   // CF_TEXT
    [InlineData(7u)]   // CF_OEMTEXT
    [InlineData(8u)]   // CF_DIB
    [InlineData(13u)]  // CF_UNICODETEXT
    [InlineData(15u)]  // CF_HDROP
    [InlineData(17u)]  // CF_DIBV5
    [InlineData(0xC000u)] // a format an app registered
    public void MemoryFormatsCanBeCopied(uint format) => Assert.True(ClipboardPolicy.IsCopyable(format));

    [Theory]
    [InlineData(2u)]   // CF_BITMAP
    [InlineData(3u)]   // CF_METAFILEPICT
    [InlineData(9u)]   // CF_PALETTE
    [InlineData(14u)]  // CF_ENHMETAFILE
    [InlineData(0x80u)]  // CF_OWNERDISPLAY
    [InlineData(0x82u)]  // CF_DSPBITMAP
    [InlineData(0x205u)] // private
    [InlineData(0x305u)] // GDI object
    public void HandleFormatsCannot(uint format) => Assert.False(ClipboardPolicy.IsCopyable(format));

    [Fact]
    public void TextAndHtmlLoseNothing() => Assert.Empty(ClipboardPolicy.Lost(new uint[] { 13, 1, 0xC001 }));

    [Fact]
    public void ABitmapAndPaletteAreRebuiltFromASavedDib() =>
        Assert.Empty(ClipboardPolicy.Lost(new uint[] { 8, 2, 9, 17 }));

    [Fact]
    public void ABitmapWithNoDibIsLost() =>
        Assert.Equal(new uint[] { 2 }, ClipboardPolicy.Lost(new uint[] { 13, 2 }));

    [Fact]
    public void MetafilesPrivateAndGdiFormatsAreLost() =>
        Assert.Equal(new uint[] { 3, 14, 0x205, 0x305 }, ClipboardPolicy.Lost(new uint[] { 0x305, 14, 3, 0x205, 13 }));

    [Fact]
    public void AnEmptyClipboardLosesNothing() => Assert.Empty(ClipboardPolicy.Lost(Array.Empty<uint>()));
}
