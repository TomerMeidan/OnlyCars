using System.Buffers.Binary;
using System.Text;
using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Application.Common;

/// <summary>
/// Image type by content (JPEG, PNG, WebP magic bytes) and a lossless strip of all metadata (EXIF incl. GPS, XMP, IPTC,
/// comments, text chunks). Keeps an allow-list of the blocks needed to show the image and drops everything else.
/// Works on the container structure only, so nothing is decoded or re-encoded.
/// </summary>
public static class ImageFiles
{
    public record Image(byte[] Content, string Extension, string ContentType);

    /// <summary>The cleaned image, or 400 <c>file.unsupportedType</c> for anything that isn't a well-formed JPEG, PNG or WebP.</summary>
    public static Image Clean(byte[] data)
    {
        try
        {
            if (data is [0xFF, 0xD8, 0xFF, ..])
            {
                return new Image(StripJpeg(data), "jpg", "image/jpeg");
            }

            if (data.AsSpan().StartsWith(PngSignature))
            {
                return new Image(StripPng(data), "png", "image/png");
            }

            if (data.Length >= 12 && data.AsSpan(0, 4).SequenceEqual("RIFF"u8) && data.AsSpan(8, 4).SequenceEqual("WEBP"u8))
            {
                return new Image(StripWebp(data), "webp", "image/webp");
            }
        }
        catch (FormatException)
        {
        }

        throw new ValidationFailedException("file.unsupportedType", "The file must be a JPEG, PNG or WebP image.");
    }

    private static ReadOnlySpan<byte> PngSignature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary><paramref name="head"/> followed by the kept [Start, End) parts of <paramref name="d"/>, in one allocation.</summary>
    private static byte[] Join(byte[] d, byte[] head, List<(int Start, int End)> parts)
    {
        var result = new byte[head.Length + parts.Sum(p => p.End - p.Start)];
        head.CopyTo(result, 0);
        var at = head.Length;
        foreach (var (start, end) in parts)
        {
            Array.Copy(d, start, result, at, end - start);
            at += end - start;
        }

        return result;
    }

    private static byte[] StripJpeg(byte[] d)
    {
        var kept = new List<(int Start, int End)>();
        int? orientation = null;
        var i = 2;
        while (true)
        {
            if (i + 2 > d.Length || d[i] != 0xFF)
            {
                throw new FormatException();
            }

            var marker = d[i + 1];
            if (marker == 0xFF)
            {
                i++; // fill byte
                continue;
            }

            if (marker == 0xD9)
            {
                // EOI; anything after it (e.g. MPF secondary images with their own EXIF) is dropped.
                kept.Add((i, i + 2));
                break;
            }

            if (i + 4 > d.Length)
            {
                throw new FormatException();
            }

            var end = i + 2 + BinaryPrimitives.ReadUInt16BigEndian(d.AsSpan(i + 2));
            if (end < i + 4 || end > d.Length)
            {
                throw new FormatException();
            }

            var payload = d.AsSpan(i + 4, end - i - 4);
            if (marker == 0xE1 && payload.StartsWith("Exif\0\0"u8))
            {
                orientation ??= ReadOrientation(payload[6..]);
            }

            // Allow-list: frame, table and scan markers (C0-DF), APP0 JFIF, APP2 ICC profile (colours) and APP14 Adobe (colour
            // transform). Every other APPn, COM, and JPGn (F0-FD: libjpeg and browsers don't decode them) is dropped.
            if (marker is >= 0xC0 and <= 0xDF
                || (marker == 0xE0 && payload.StartsWith("JFIF\0"u8))
                || (marker == 0xE2 && payload.StartsWith("ICC_PROFILE\0"u8))
                || (marker == 0xEE && payload.StartsWith("Adobe"u8)))
            {
                kept.Add((i, end));
            }

            i = end;
            if (marker == 0xDA)
            {
                // SOS: entropy-coded data runs to the next marker that isn't a stuffed 0xFF00 or a restart marker.
                var start = i;
                while (i + 1 < d.Length && !(d[i] == 0xFF && d[i + 1] != 0x00 && d[i + 1] is < 0xD0 or > 0xD7))
                {
                    i++;
                }

                if (i + 1 >= d.Length)
                {
                    kept.Add((start, d.Length)); // truncated file without EOI: keep the scan data as is
                    break;
                }

                kept.Add((start, i));
            }
        }

        // Without EXIF a rotated phone photo would show sideways, so put back a minimal EXIF with only Orientation.
        byte[] head = orientation is > 1
            ?
            [
                0xFF, 0xD8,
                0xFF, 0xE1, 0x00, 0x22, (byte)'E', (byte)'x', (byte)'i', (byte)'f', 0, 0,
                (byte)'M', (byte)'M', 0x00, 0x2A, 0, 0, 0, 8, // TIFF header, IFD0 at 8
                0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, (byte)orientation, 0, 0, // 1 entry: Orientation SHORT
                0, 0, 0, 0 // no next IFD
            ]
            : [0xFF, 0xD8];
        return Join(d, head, kept);
    }

    /// <summary>EXIF Orientation (1 to 8) from IFD0 of a TIFF block, or null.</summary>
    private static int? ReadOrientation(ReadOnlySpan<byte> t)
    {
        if (t.Length < 8 || (t[0], t[1]) is not ((0x49, 0x49) or (0x4D, 0x4D)))
        {
            return null;
        }

        var little = t[0] == 0x49;
        var ifd = little ? BinaryPrimitives.ReadUInt32LittleEndian(t[4..]) : BinaryPrimitives.ReadUInt32BigEndian(t[4..]);
        if (ifd > t.Length - 2)
        {
            return null;
        }

        var count = U16(t, (int)ifd, little);
        for (var e = (int)ifd + 2; count-- > 0 && e + 12 <= t.Length; e += 12)
        {
            if (U16(t, e, little) == 0x0112)
            {
                return U16(t, e + 8, little) is var v and >= 1 and <= 8 ? v : null;
            }
        }

        return null;

        static int U16(ReadOnlySpan<byte> t, int p, bool little) =>
            little ? BinaryPrimitives.ReadUInt16LittleEndian(t[p..]) : BinaryPrimitives.ReadUInt16BigEndian(t[p..]);
    }

    // shortcut: PNG eXIf / WebP EXIF orientation is dropped with the rest (rare outside phones, which send JPEG); keep it if rotated PNGs or WebPs show up.
    private static byte[] StripPng(byte[] d)
    {
        var kept = new List<(int Start, int End)> { (0, 8) };
        var i = 8;
        while (true)
        {
            if (i + 12 > d.Length)
            {
                throw new FormatException();
            }

            var length = BinaryPrimitives.ReadUInt32BigEndian(d.AsSpan(i));
            if (length > d.Length - i - 12)
            {
                throw new FormatException();
            }

            var type = Encoding.ASCII.GetString(d, i + 4, 4);
            var end = i + 12 + (int)length;
            // Allow-list: image data, colour and animation (APNG) chunks; text, EXIF, time and unknown chunks are dropped.
            if (type is "IHDR" or "PLTE" or "IDAT" or "IEND" or "tRNS" or "cHRM" or "gAMA" or "iCCP" or "sBIT" or "sRGB" or "cICP"
                or "bKGD" or "pHYs" or "acTL" or "fcTL" or "fdAT")
            {
                kept.Add((i, end));
            }

            if (type == "IEND")
            {
                return Join(d, [], kept); // anything after IEND is dropped
            }

            i = end;
        }
    }

    // shortcut: chunks nested inside an ANMF frame are kept as they are (in practice only ALPH and image data);
    // walk them too if animated WebPs with metadata inside frames show up.
    private static byte[] StripWebp(byte[] d)
    {
        var riffEnd = 8 + (long)BinaryPrimitives.ReadUInt32LittleEndian(d.AsSpan(4));
        if (riffEnd > d.Length)
        {
            throw new FormatException();
        }

        var kept = new List<(int Start, int End)> { (0, 12) };
        var i = 12;
        while (i < riffEnd)
        {
            if (i + 8 > riffEnd)
            {
                throw new FormatException();
            }

            var size = BinaryPrimitives.ReadUInt32LittleEndian(d.AsSpan(i + 4));
            var end = i + 8 + size + (size & 1); // chunks are padded to an even size
            if (end > riffEnd)
            {
                throw new FormatException();
            }

            // Allow-list: image, alpha, animation and colour-profile chunks; EXIF, XMP and unknown chunks are dropped.
            if (Encoding.ASCII.GetString(d, i, 4) is "VP8X" or "VP8 " or "VP8L" or "ALPH" or "ANIM" or "ANMF" or "ICCP")
            {
                kept.Add((i, (int)end));
            }

            i = (int)end;
        }

        var result = Join(d, [], kept);
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(4), (uint)(result.Length - 8));
        if (result.Length > 20 && result.AsSpan(12, 4).SequenceEqual("VP8X"u8) && BinaryPrimitives.ReadUInt32LittleEndian(result.AsSpan(16)) > 0)
        {
            result[20] &= unchecked((byte)~0x0C); // VP8X comes first; clear its EXIF (0x08) and XMP (0x04) flags
        }

        return result;
    }
}
