using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static unsafe class EcoIconHelper
{
    [DllImport("Unpack.dll")]
    private static extern int Unpack(byte[] source, int sourceSize, byte** destination, out int destinationSize, int mode);

    private sealed class ArchiveEntry
    {
        public int Offset;
        public int PackedSize;
        public int UnpackedSize;
    }

    private sealed class Part
    {
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public int Size;
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 3)
                throw new ArgumentException("usage: EcoIconHelper.exe <game-root> <skill-id> <output.png>");

            int skillId;
            if (!int.TryParse(args[1], out skillId) || skillId <= 0 || skillId > UInt16.MaxValue)
                throw new ArgumentException("invalid skill id");

            string root = FindGameRoot(args[0]);
            int iconId = FindIconId(Path.Combine(root, "data", "effect", "effect.ssp"), skillId);
            if (iconId <= 0)
                return 2;

            string archive = Path.Combine(root, "data", "sprite", "skillicon", "skillicon.hed");
            byte[] texture = ExtractArchiveFile(archive, String.Format("SI_{0:D4}.TGA", iconId));
            if (texture == null)
                return 2;

            string output = Path.GetFullPath(args[2]);
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            using (Bitmap image = DecodeTexture(texture))
                image.Save(output, ImageFormat.Png);

            Console.WriteLine(iconId);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
            return 1;
        }
    }

    private static string FindGameRoot(string candidate)
    {
        string current = Path.GetFullPath(candidate);
        if (File.Exists(current))
            current = Path.GetDirectoryName(current);

        for (int level = 0; level < 5 && !String.IsNullOrEmpty(current); level++)
        {
            if (File.Exists(Path.Combine(current, "data", "effect", "effect.ssp")) &&
                File.Exists(Path.Combine(current, "data", "sprite", "skillicon", "skillicon.hed")))
                return current;
            current = Path.GetDirectoryName(current);
        }
        throw new DirectoryNotFoundException("ECO game data was not found");
    }

    private static int FindIconId(string effectPath, int skillId)
    {
        using (FileStream stream = File.OpenRead(effectPath))
        using (BinaryReader reader = new BinaryReader(stream))
        {
            for (int index = 0; index < 30000 && stream.Position + 4 <= stream.Length; index++)
            {
                uint offset = reader.ReadUInt32();
                if (offset == 0)
                    break;
                long tablePosition = stream.Position;
                if (offset + 4 > stream.Length)
                {
                    stream.Position = tablePosition;
                    continue;
                }
                stream.Position = offset;
                int currentSkill = reader.ReadUInt16();
                int icon = reader.ReadUInt16();
                if (currentSkill == skillId)
                    return icon == 0 ? currentSkill : icon;
                stream.Position = tablePosition;
            }
        }
        return 0;
    }

    private static byte[] ExtractArchiveFile(string headerPath, string requestedName)
    {
        string dataPath = Path.ChangeExtension(headerPath, ".dat");
        using (BinaryReader header = new BinaryReader(File.OpenRead(headerPath)))
        using (BinaryReader data = new BinaryReader(File.OpenRead(dataPath)))
        {
            int namesOffset = header.ReadInt32();
            int packedNamesSize = header.ReadInt32() & 0x7FFFFFFF;
            int namesSize = header.ReadInt32();
            data.BaseStream.Position = namesOffset;
            byte[] names = ReadPayload(data.ReadBytes(packedNamesSize), packedNamesSize, namesSize);

            List<string> fileNames = ReadNames(names);
            ArchiveEntry selected = null;
            for (int index = 0; index < fileNames.Count; index++)
            {
                ArchiveEntry entry = new ArchiveEntry {
                    Offset = header.ReadInt32(),
                    PackedSize = header.ReadInt32() & 0x7FFFFFFF,
                    UnpackedSize = header.ReadInt32()
                };
                if (String.Equals(fileNames[index], requestedName, StringComparison.OrdinalIgnoreCase))
                    selected = entry;
            }

            if (selected == null)
                return null;
            data.BaseStream.Position = selected.Offset;
            return ReadPayload(data.ReadBytes(selected.PackedSize), selected.PackedSize, selected.UnpackedSize);
        }
    }

    private static List<string> ReadNames(byte[] payload)
    {
        using (BinaryReader reader = new BinaryReader(new MemoryStream(payload)))
        {
            int count = reader.ReadInt32();
            string text = Encoding.ASCII.GetString(reader.ReadBytes(payload.Length - 4));
            string[] split = text.Split('\0');
            List<string> names = new List<string>(count);
            for (int index = 0; index < count; index++)
                names.Add(index < split.Length ? split[index] : String.Empty);
            return names;
        }
    }

    private static byte[] ReadPayload(byte[] packed, int packedSize, int unpackedSize)
    {
        if (packedSize == unpackedSize)
            return packed;
        byte[] output = new byte[unpackedSize];
        fixed (byte* outputPointer = output)
        {
            byte* destination = outputPointer;
            int destinationSize = output.Length;
            if (Unpack(packed, packed.Length, &destination, out destinationSize, 1) != 1)
                throw new InvalidDataException("archive decompression failed");
            if (destinationSize != output.Length)
                throw new InvalidDataException("archive decompression size mismatch");
        }
        return output;
    }

    private static Bitmap DecodeTexture(byte[] payload)
    {
        if (payload.Length < 18)
            throw new InvalidDataException("texture is too short");

        int ecoFormat = BitConverter.ToInt32(payload, 0);
        int marker = BitConverter.ToUInt16(payload, 10);
        if (ecoFormat >= 0 && ecoFormat <= 2 && marker == 0x100)
            return DecodeEcoTexture(payload);
        return DecodeTga(payload);
    }

    private static Bitmap DecodeEcoTexture(byte[] payload)
    {
        using (BinaryReader reader = new BinaryReader(new MemoryStream(payload)))
        {
            int format = reader.ReadInt32();
            int width = reader.ReadUInt16();
            int height = reader.ReadUInt16();
            int partCount = reader.ReadUInt16();
            if (reader.ReadUInt16() != 0x100 || reader.ReadInt32() != 0 || width <= 0 || height <= 0 || partCount <= 0)
                throw new InvalidDataException("invalid ECO texture header");

            Part[] parts = new Part[partCount];
            for (int index = 0; index < partCount; index++)
            {
                Part part = new Part();
                if (index > 0)
                {
                    part.X = reader.ReadInt16() / 256;
                    part.Y = reader.ReadInt16() / 256;
                }
                part.Width = reader.ReadUInt16();
                part.Height = reader.ReadUInt16();
                part.Size = reader.ReadInt32();
                parts[index] = part;
            }

            Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            foreach (Part part in parts)
            {
                int bytesPerPixel = format == 2 ? 4 : 2;
                int expected = part.Width * part.Height * bytesPerPixel;
                if (part.Size != expected || reader.BaseStream.Position + expected > reader.BaseStream.Length)
                    throw new InvalidDataException("invalid ECO texture part");
                for (int y = 0; y < part.Height; y++)
                {
                    for (int x = 0; x < part.Width; x++)
                    {
                        Color color;
                        if (format == 2)
                        {
                            byte blue = reader.ReadByte();
                            byte green = reader.ReadByte();
                            byte red = reader.ReadByte();
                            byte alpha = reader.ReadByte();
                            color = Color.FromArgb(alpha, red, green, blue);
                        }
                        else
                        {
                            ushort value = reader.ReadUInt16();
                            color = format == 0 ? DecodeArgb1555(value) : DecodeArgb4444(value);
                        }
                        int targetX = part.X + x;
                        int targetY = part.Y + y;
                        if (targetX < width && targetY < height)
                            bitmap.SetPixel(targetX, targetY, color);
                    }
                }
            }
            return bitmap;
        }
    }

    private static Bitmap DecodeTga(byte[] payload)
    {
        using (BinaryReader reader = new BinaryReader(new MemoryStream(payload)))
        {
            int idLength = reader.ReadByte();
            int colorMapType = reader.ReadByte();
            int imageType = reader.ReadByte();
            reader.BaseStream.Position += 9;
            int width = reader.ReadUInt16();
            int height = reader.ReadUInt16();
            int bits = reader.ReadByte();
            int attributes = reader.ReadByte();
            if (colorMapType != 0 || !new int[] { 2, 3, 10, 11 }.Contains(imageType) || !new int[] { 8, 16, 24, 32 }.Contains(bits))
                throw new InvalidDataException("unsupported TGA format");
            reader.BaseStream.Position += idLength;

            int pixelCount = width * height;
            Color[] pixels = new Color[pixelCount];
            int written = 0;
            while (written < pixelCount)
            {
                int count = 1;
                bool repeated = false;
                if (imageType == 10 || imageType == 11)
                {
                    int packet = reader.ReadByte();
                    repeated = (packet & 0x80) != 0;
                    count = (packet & 0x7F) + 1;
                }
                Color first = ReadTgaPixel(reader, bits);
                for (int index = 0; index < count && written < pixelCount; index++)
                    pixels[written++] = index == 0 || repeated ? first : ReadTgaPixel(reader, bits);
            }

            bool topOrigin = (attributes & 0x20) != 0;
            bool rightOrigin = (attributes & 0x10) != 0;
            Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            for (int index = 0; index < pixels.Length; index++)
            {
                int sourceX = index % width;
                int sourceY = index / width;
                int x = rightOrigin ? width - sourceX - 1 : sourceX;
                int y = topOrigin ? sourceY : height - sourceY - 1;
                bitmap.SetPixel(x, y, pixels[index]);
            }
            return bitmap;
        }
    }

    private static Color ReadTgaPixel(BinaryReader reader, int bits)
    {
        if (bits == 8)
        {
            byte gray = reader.ReadByte();
            return Color.FromArgb(255, gray, gray, gray);
        }
        if (bits == 16)
            return DecodeArgb1555(reader.ReadUInt16());
        byte blue = reader.ReadByte();
        byte green = reader.ReadByte();
        byte red = reader.ReadByte();
        byte alpha = bits == 32 ? reader.ReadByte() : (byte)255;
        return Color.FromArgb(alpha, red, green, blue);
    }

    private static Color DecodeArgb1555(ushort value)
    {
        int alpha = (value & 0x8000) != 0 ? 255 : 0;
        int red = ((value >> 10) & 31) * 255 / 31;
        int green = ((value >> 5) & 31) * 255 / 31;
        int blue = (value & 31) * 255 / 31;
        return Color.FromArgb(alpha, red, green, blue);
    }

    private static Color DecodeArgb4444(ushort value)
    {
        int alpha = ((value >> 12) & 15) * 17;
        int red = ((value >> 8) & 15) * 17;
        int green = ((value >> 4) & 15) * 17;
        int blue = (value & 15) * 17;
        return Color.FromArgb(alpha, red, green, blue);
    }

    private static bool Contains(this int[] values, int value)
    {
        foreach (int candidate in values)
            if (candidate == value) return true;
        return false;
    }
}
