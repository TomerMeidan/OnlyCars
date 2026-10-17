using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OnlyCars.Api.Common;
using OnlyCars.Api.Controllers;
using OnlyCars.Api.Middleware;
using OnlyCars.Application;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Infrastructure;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>In-memory stand-in for R2; nothing in the tests talks to R2.</summary>
public class FakeFileStorage : IFileStorage
{
    public Dictionary<string, (byte[] Content, string ContentType)> Objects { get; } = new();
    public bool FailDeletes { get; set; }

    /// <summary>When set, uploads wait for it, so a test can hold requests open.</summary>
    public TaskCompletionSource? PutGate { get; set; }
    public int Waiting;

    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken ct = default)
    {
        if (PutGate is { } gate)
        {
            Interlocked.Increment(ref Waiting);
            await gate.Task;
        }

        lock (Objects)
        {
            Objects[key] = (content, contentType);
        }
    }

    public Task DeleteAsync(string key, CancellationToken ct = default)
    {
        if (FailDeletes)
        {
            throw new IOException("storage down");
        }

        Objects.Remove(key);
        return Task.CompletedTask;
    }

    public string GetSignedUrl(string key, TimeSpan validFor) => $"https://signed.test/{key}?expires={validFor.TotalSeconds}";
}

public class VehiclePhotoTests
{
    private readonly string dbName = Guid.NewGuid().ToString();
    private readonly AppDbContext db;
    private readonly FakeFileStorage storage = new();
    private readonly VehicleService vehicles;
    private readonly Guid userId = Guid.NewGuid();

    public VehiclePhotoTests()
    {
        db = NewDb();
        vehicles = new VehicleService(db, storage);
    }

    // One store shared by name: the HTTP host gets its own contexts, since DI disposes what it creates.
    private AppDbContext NewDb() => new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(dbName).Options);

    // A real 1x1 PNG.
    private static readonly byte[] Png1x1 = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    private static byte[] Chunk(string type, byte[] data)
    {
        var chunk = new byte[12 + data.Length];
        BinaryPrimitives.WriteUInt32BigEndian(chunk, (uint)data.Length);
        Encoding.ASCII.GetBytes(type).CopyTo(chunk, 4);
        data.CopyTo(chunk, 8);
        return chunk; // CRC left zero; nothing here checks it
    }

    /// <summary>The 1x1 PNG with a tEXt chunk (and optional padding inside it) after IHDR, plus junk after IEND.</summary>
    private static byte[] PngWithText(int textBytes = 20)
    {
        var text = Encoding.ASCII.GetBytes("Comment\0SECRET-TEXT" + new string('x', Math.Max(0, textBytes - 19)));
        return [.. Png1x1[..33], .. Chunk("tEXt", text), .. Png1x1[33..], .. "AFTER-IEND"u8.ToArray()];
    }

    private static byte[] Segment(byte marker, byte[] payload)
    {
        var s = new byte[4 + payload.Length];
        s[0] = 0xFF;
        s[1] = marker;
        BinaryPrimitives.WriteUInt16BigEndian(s.AsSpan(2), (ushort)(payload.Length + 2));
        payload.CopyTo(s, 4);
        return s;
    }

    /// <summary>A JPEG with EXIF (Orientation 6 and a GPS IFD), XMP, a comment, scan data and an MPF-like trailer after EOI.</summary>
    private static byte[] JpegWithGps()
    {
        // Little-endian TIFF: IFD0 at 8 with Orientation=6 and GPSInfo -> GPS IFD at 38 holding GPSLatitudeRef "N" and a marker.
        var tiff = new byte[80];
        "II*\0"u8.CopyTo(tiff);
        BinaryPrimitives.WriteUInt32LittleEndian(tiff.AsSpan(4), 8);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(8), 2);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(10), 0x0112);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(12), 3);
        BinaryPrimitives.WriteUInt32LittleEndian(tiff.AsSpan(14), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(18), 6);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(22), 0x8825);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(24), 4);
        BinaryPrimitives.WriteUInt32LittleEndian(tiff.AsSpan(26), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(tiff.AsSpan(30), 38);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(38), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(40), 0x0001);
        BinaryPrimitives.WriteUInt16LittleEndian(tiff.AsSpan(42), 2);
        BinaryPrimitives.WriteUInt32LittleEndian(tiff.AsSpan(44), 2);
        tiff[48] = (byte)'N';
        "GPS-LAT-32.0853"u8.CopyTo(tiff.AsSpan(60));

        return
        [
            0xFF, 0xD8,
            .. Segment(0xE0, [.. "JFIF\0"u8, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
            .. Segment(0xE1, [.. "Exif\0\0"u8, .. tiff]),
            .. Segment(0xE1, [.. "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>XMP-SECRET</x:xmpmeta>"u8]),
            .. Segment(0xE2, [.. "MPF\0"u8, .. "MPF-SECRET"u8]),
            .. Segment(0xE2, [.. "ICC_PROFILE\0"u8, 1, 1, .. "ICC"u8]),
            .. Segment(0xFE, [.. "COMMENT-SECRET"u8]),
            .. Segment(0xDB, new byte[65]),
            .. Segment(0xDA, [1, 1, 0, 0, 63, 0]),
            0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56, // scan data with a stuffed 0xFF and a restart marker
            0xFF, 0xD9,
            .. "Exif-AFTER-EOI GPS"u8
        ];
    }

    private static bool Contains(byte[] data, string text) => data.AsSpan().IndexOf(Encoding.ASCII.GetBytes(text)) >= 0;

    private Task<VehicleDto> CarAsync(Guid? owner = null) => vehicles.CreateAsync(owner ?? userId,
        new CreateVehicleRequest("Corolla", null, null, null, null, null, null, null, null, null, null));

    [Fact]
    public void Jpeg_LosesExifGpsXmpAndComments_KeepsOrientationIccAndScanData()
    {
        var image = ImageFiles.Clean(JpegWithGps());

        Assert.Equal(("jpg", "image/jpeg"), (image.Extension, image.ContentType));
        foreach (var secret in new[] { "GPS-LAT", "XMP-SECRET", "MPF-SECRET", "COMMENT-SECRET", "AFTER-EOI", "xap" })
        {
            Assert.False(Contains(image.Content, secret), secret);
        }

        byte[] orientationOnly = [0xFF, 0xE1, 0x00, 0x22, .. "Exif\0\0MM\0*"u8, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
        Assert.Equal(orientationOnly, image.Content[2..38]);
        Assert.True(Contains(image.Content, "ICC_PROFILE"));
        Assert.True(Contains(image.Content, "JFIF"));
        Assert.True(image.Content.AsSpan().IndexOf(new byte[] { 0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56, 0xFF, 0xD9 }) > 0);
        Assert.Equal(new byte[] { 0xFF, 0xD9 }, image.Content[^2..]);
    }

    [Fact]
    public void Jpeg_WithoutOrientation_GetsNoExifSegment()
    {
        byte[] jpeg = [0xFF, 0xD8, .. Segment(0xE1, [.. "Exif\0\0"u8, .. "MM\0*"u8, 0, 0, 0, 8, 0, 0]), .. Segment(0xDA, [0]), 1, 2, 0xFF, 0xD9];

        var image = ImageFiles.Clean(jpeg);

        byte[] expected = [0xFF, 0xD8, .. Segment(0xDA, [0]), 1, 2, 0xFF, 0xD9];
        Assert.Equal(expected, image.Content);
    }

    [Fact]
    public void Png_LosesTextChunksAndTrailer_KeepsImageChunks()
    {
        var image = ImageFiles.Clean(PngWithText());

        Assert.Equal(("png", "image/png"), (image.Extension, image.ContentType));
        Assert.Equal(Png1x1, image.Content);
    }

    [Fact]
    public void Webp_LosesExifAndXmpChunks_ClearsTheirFlags_FixesRiffSize()
    {
        byte[] vp8x = [0x0C | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // EXIF, XMP and alpha flags
        byte[] body =
        [
            .. "WEBP"u8,
            .. WebpChunk("VP8X", vp8x),
            .. WebpChunk("VP8L", [0x2F, 0, 0, 0, 0]),
            .. WebpChunk("EXIF", [.. "GPS-SECRET"u8, 1]), // odd size, padded
            .. WebpChunk("XMP ", [.. "XMP-SECRET"u8])
        ];
        byte[] webp = [.. "RIFF"u8, 0, 0, 0, 0, .. body];
        BinaryPrimitives.WriteUInt32LittleEndian(webp.AsSpan(4), (uint)body.Length);

        var image = ImageFiles.Clean(webp);

        Assert.Equal(("webp", "image/webp"), (image.Extension, image.ContentType));
        Assert.False(Contains(image.Content, "SECRET"));
        Assert.Equal(0x10, image.Content[20]);
        Assert.Equal(image.Content.Length - 8, (int)BinaryPrimitives.ReadUInt32LittleEndian(image.Content.AsSpan(4)));
        Assert.Equal(12 + 18 + 14, image.Content.Length);
    }

    private static byte[] WebpChunk(string type, byte[] data)
    {
        var chunk = new byte[8 + data.Length + (data.Length & 1)];
        Encoding.ASCII.GetBytes(type).CopyTo(chunk, 0);
        BinaryPrimitives.WriteUInt32LittleEndian(chunk.AsSpan(4), (uint)data.Length);
        data.CopyTo(chunk, 8);
        return chunk;
    }

    [Fact]
    public void Png_KeepsOnlyAllowListedChunks()
    {
        byte[] gama = Chunk("gAMA", [0, 0, 0xB1, 0x8F]);
        byte[] png = [.. Png1x1[..33], .. Chunk("caBX", [.. "C2PA-SECRET"u8]), .. gama, .. Chunk("prVt", [.. "PRIVATE-SECRET"u8]), .. Png1x1[33..]];

        var image = ImageFiles.Clean(png);

        Assert.Equal([.. Png1x1[..33], .. gama, .. Png1x1[33..]], image.Content);
    }

    [Fact]
    public void Webp_KeepsOnlyAllowListedChunks_AndAVp8xWithoutFlagsIsUntouched()
    {
        byte[] kept = [.. WebpChunk("VP8X", new byte[10]), .. WebpChunk("ICCP", [1, 2, 3]), .. WebpChunk("VP8L", [0x2F, 0, 0, 0, 0])];
        byte[] body = [.. "WEBP"u8, .. kept[..18], .. WebpChunk("UNKN", [.. "UNKNOWN-SECRET"u8]), .. kept[18..], .. WebpChunk("C2PA", [.. "C2PA-SECRET"u8])];
        byte[] webp = [.. "RIFF"u8, 0, 0, 0, 0, .. body];
        BinaryPrimitives.WriteUInt32LittleEndian(webp.AsSpan(4), (uint)body.Length);

        var image = ImageFiles.Clean(webp);

        byte[] expected = [.. "RIFF"u8, 0, 0, 0, 0, .. "WEBP"u8, .. kept];
        BinaryPrimitives.WriteUInt32LittleEndian(expected.AsSpan(4), (uint)(expected.Length - 8));
        Assert.Equal(expected, image.Content);
    }

    [Fact]
    public void Jpeg_KeepsApp0OnlyForJfif_App14OnlyForAdobe_AndDropsJpgnSegments()
    {
        byte[] jfif = Segment(0xE0, [.. "JFIF\0"u8, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
        byte[] adobe = Segment(0xEE, [.. "Adobe"u8, 0, 100, 0, 0, 0, 0, 1]);
        byte[] scan = [.. Segment(0xDB, new byte[65]), .. Segment(0xDA, [0]), 1, 2, 0xFF, 0xD9];
        byte[] jpeg =
        [
            0xFF, 0xD8, .. jfif,
            .. Segment(0xE0, [.. "JFXX\0"u8, .. "THUMB-SECRET"u8]),
            .. adobe,
            .. Segment(0xEE, [.. "OTHER-SECRET"u8]),
            .. Segment(0xF0, [.. "JPG0-SECRET"u8]),
            .. Segment(0xFD, [.. "JPG13-SECRET"u8]),
            .. scan
        ];

        var image = ImageFiles.Clean(jpeg);

        Assert.Equal([0xFF, 0xD8, .. jfif, .. adobe, .. scan], image.Content);
    }

    [Fact]
    public async Task AStoredKeyOutsideTheCarsOwnPrefix_IsNoPhoto_NeverSignedOrDeleted()
    {
        var car = await CarAsync();
        var otherCar = await CarAsync(Guid.NewGuid());
        var foreign = new[]
        {
            $"users/{Guid.NewGuid()}/vehicles/{otherCar.Id}/photo/{Guid.NewGuid():N}.jpg", // another user's prefix
            $"users/{userId}/vehicles/{otherCar.Id}/photo/{Guid.NewGuid():N}.jpg", // another car
            $"users/{userId}/vehicles/{car.Id}/photo/../../../../other.jpg", // escapes the prefix
            $"users/{userId}/vehicles/{car.Id}/photo/sub/{Guid.NewGuid():N}.jpg"
        };

        foreach (var key in foreign)
        {
            storage.Objects[key] = ([1], "image/jpeg");
            var row = db.Vehicles.Single(v => v.Id == car.Id);
            row.PhotoUrl = key;
            await db.SaveChangesAsync();

            Assert.Null((await vehicles.GetAsync(userId, car.Id)).PhotoUrl);
            await vehicles.DeletePhotoAsync(userId, car.Id);
            Assert.True(storage.Objects.ContainsKey(key), key);

            await vehicles.SetPhotoAsync(userId, car.Id, Png1x1); // replaces it without deleting the foreign object
            Assert.True(storage.Objects.ContainsKey(key), key);
            Assert.StartsWith($"users/{userId}/vehicles/{car.Id}/photo/", db.Vehicles.Single(v => v.Id == car.Id).PhotoUrl);
        }
    }

    public static TheoryData<byte[]> NotImages => new(new byte[][]
    {
        Encoding.UTF8.GetBytes("just some text, saved as car.jpg"),
        [0xFF, 0xD8, 0xFF], // JPEG magic, then nothing
        [0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF, 1, 2], // a segment longer than the file
        Png1x1[..20], // PNG cut inside IHDR
        [.. "RIFF"u8, 0xFF, 0xFF, 0, 0, .. "WEBP"u8], // RIFF size beyond the file
        [.. "GIF89a"u8, 1, 0, 1, 0]
    });

    [Theory]
    [MemberData(nameof(NotImages))]
    public void NotAWellFormedImage_IsUnsupportedType(byte[] data)
    {
        var ex = Assert.Throws<ValidationFailedException>(() => ImageFiles.Clean(data));
        Assert.Equal("file.unsupportedType", ex.Code);
    }

    [Fact]
    public async Task Upload_StoresCleanedImageUnderTheUsersPrefix_DtoGetsSignedUrlNeverTheKey()
    {
        var car = await CarAsync();

        var dto = await vehicles.SetPhotoAsync(userId, car.Id, JpegWithGps());

        var (key, stored) = Assert.Single(storage.Objects);
        Assert.Matches($"^users/{userId}/vehicles/{car.Id}/photo/[0-9a-f]{{32}}\\.jpg$", key);
        Assert.Equal("image/jpeg", stored.ContentType);
        Assert.False(Contains(stored.Content, "GPS-LAT"));
        Assert.Equal(key, db.Vehicles.Single().PhotoUrl);
        Assert.Equal($"https://signed.test/{key}?expires=3600", dto.PhotoUrl);
        Assert.Equal(dto.PhotoUrl, (await vehicles.GetAsync(userId, car.Id)).PhotoUrl);
        Assert.Equal(dto.PhotoUrl, Assert.Single(await vehicles.ListAsync(userId, includeArchived: true)).PhotoUrl);
    }

    [Fact]
    public async Task Replace_DeletesThePreviousObject_AndAFailedDeleteIsNotAnError()
    {
        var car = await CarAsync();
        await vehicles.SetPhotoAsync(userId, car.Id, Png1x1);
        var first = Assert.Single(storage.Objects).Key;

        await vehicles.SetPhotoAsync(userId, car.Id, JpegWithGps());
        var second = Assert.Single(storage.Objects).Key;
        Assert.NotEqual(first, second);
        Assert.EndsWith(".jpg", second);

        storage.FailDeletes = true;
        var dto = await vehicles.SetPhotoAsync(userId, car.Id, Png1x1);
        Assert.Equal(2, storage.Objects.Count); // the old one is orphaned, the car points at the new one
        Assert.EndsWith(".png", db.Vehicles.Single().PhotoUrl);
        Assert.EndsWith(".png?expires=3600", dto.PhotoUrl);
    }

    [Fact]
    public async Task Delete_ClearsThePhotoAndTheObject_AlsoOnAnArchivedCar_AndIsANoOpWithoutAPhoto()
    {
        var car = await CarAsync();
        await vehicles.SetPhotoAsync(userId, car.Id, Png1x1);
        await vehicles.ArchiveAsync(userId, car.Id, archived: true);

        await vehicles.DeletePhotoAsync(userId, car.Id);
        await vehicles.DeletePhotoAsync(userId, car.Id);

        Assert.Empty(storage.Objects);
        Assert.Null(db.Vehicles.Single().PhotoUrl);
        Assert.Null((await vehicles.GetAsync(userId, car.Id)).PhotoUrl);
    }

    [Fact]
    public async Task ArchivedCar_CantGetANewPhoto()
    {
        var car = await CarAsync();
        await vehicles.ArchiveAsync(userId, car.Id, archived: true);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => vehicles.SetPhotoAsync(userId, car.Id, Png1x1));

        Assert.Equal("vehiclePhoto.vehicleArchived", ex.Code);
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task AnotherUsersCar_IsNotFound_ForUploadAndDelete()
    {
        var car = await CarAsync();
        await vehicles.SetPhotoAsync(userId, car.Id, Png1x1);
        var stranger = Guid.NewGuid();

        var upload = await Assert.ThrowsAsync<NotFoundException>(() => vehicles.SetPhotoAsync(stranger, car.Id, Png1x1));
        var delete = await Assert.ThrowsAsync<NotFoundException>(() => vehicles.DeletePhotoAsync(stranger, car.Id));

        Assert.Equal("vehicle.notFound", upload.Code);
        Assert.Equal("vehicle.notFound", delete.Code);
        Assert.Single(storage.Objects);
        Assert.NotNull(db.Vehicles.Single().PhotoUrl);
    }

    [Fact]
    public async Task EmptyOrOver10MB_IsRejected_BeforeAnyUpload()
    {
        var car = await CarAsync();
        byte[] tooBig = [.. Png1x1, .. new byte[VehicleService.MaxPhotoBytes + 1 - Png1x1.Length]];

        var empty = await Assert.ThrowsAsync<ValidationFailedException>(() => vehicles.SetPhotoAsync(userId, car.Id, []));
        var missing = await Assert.ThrowsAsync<ValidationFailedException>(() => vehicles.SetPhotoAsync(userId, car.Id, null));
        var large = await Assert.ThrowsAsync<PayloadTooLargeException>(() => vehicles.SetPhotoAsync(userId, car.Id, tooBig));
        await vehicles.SetPhotoAsync(userId, car.Id, [.. PngWithText(VehicleService.MaxPhotoBytes - Png1x1.Length - 22)]);

        Assert.Equal("file.required", empty.Code);
        Assert.Equal("file.required", missing.Code);
        Assert.Equal("file.tooLarge", large.Code);
        Assert.Equal(VehicleService.MaxPhotoBytes, large.Extensions["maxBytes"]);
        Assert.Single(storage.Objects); // only the one at exactly 10 MB
    }

    [Fact]
    public async Task PostAndPut_IgnorePhotoUrl()
    {
        var created = await vehicles.CreateAsync(userId,
            new CreateVehicleRequest("Corolla", null, null, null, null, null, null, null, null, "users/other/vehicles/x/photo/y.jpg", null));
        Assert.Null(created.PhotoUrl);
        Assert.Null(db.Vehicles.Single().PhotoUrl);

        await vehicles.SetPhotoAsync(userId, created.Id, Png1x1);
        var key = db.Vehicles.Single().PhotoUrl;
        var updated = await vehicles.UpdateAsync(userId, created.Id,
            new UpdateVehicleRequest("Corolla", null, null, null, null, null, null, null, null, "users/other/vehicles/x/photo/y.jpg"));
        await vehicles.UpdateAsync(userId, created.Id, new UpdateVehicleRequest("Corolla", null, null, null, null, null, null, null, null, null));

        Assert.Equal(key, db.Vehicles.Single().PhotoUrl);
        Assert.Equal($"https://signed.test/{key}?expires=3600", updated.PhotoUrl);
    }

    [Fact]
    public async Task WithoutStorage_PhotoEndpointsAre503_AndDtosHaveNoPhotoUrl()
    {
        var car = await CarAsync();
        await vehicles.SetPhotoAsync(userId, car.Id, Png1x1);
        var noStorage = new VehicleService(db);

        var upload = await Assert.ThrowsAsync<ServiceUnavailableException>(() => noStorage.SetPhotoAsync(userId, car.Id, Png1x1));
        var delete = await Assert.ThrowsAsync<ServiceUnavailableException>(() => noStorage.DeletePhotoAsync(userId, car.Id));

        Assert.Equal("file.storageUnavailable", upload.Code);
        Assert.Equal("file.storageUnavailable", delete.Code);
        Assert.Null((await noStorage.GetAsync(userId, car.Id)).PhotoUrl);
        Assert.NotNull(db.Vehicles.Single().PhotoUrl); // the key is kept for when storage is back
    }

    [Fact]
    public void Infrastructure_RegistersStorageOnlyWithAllFourR2Settings_AndSignsOfflineForOneHour()
    {
        IServiceProvider Build(Dictionary<string, string?> settings) => new ServiceCollection()
            .AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(settings).Build())
            .BuildServiceProvider();
        var r2 = new Dictionary<string, string?>
        {
            ["R2:AccountId"] = "acct", ["R2:AccessKeyId"] = "id", ["R2:SecretAccessKey"] = "fake-secret", ["R2:BucketName"] = "bucket"
        };

        Assert.Null(Build([]).GetService<IFileStorage>());
        Assert.Null(Build(new(r2) { ["R2:BucketName"] = "" }).GetService<IFileStorage>());
        var url = Build(r2).GetRequiredService<IFileStorage>().GetSignedUrl("users/u/vehicles/v/photo/f.jpg", TimeSpan.FromHours(1));

        Assert.StartsWith("https://acct.r2.cloudflarestorage.com/bucket/users/u/vehicles/v/photo/f.jpg?", url);
        Assert.Contains("X-Amz-Expires=3600", url);
        Assert.DoesNotContain("fake-secret", url);
    }

    // ---- HTTP: the real VehiclesController on Kestrel, with the app's body limits, error handler and a header-based test login.

    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> o, ILoggerFactory l, UrlEncoder e)
        : AuthenticationHandler<AuthenticationSchemeOptions>(o, l, e)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
            Task.FromResult(Request.Headers.TryGetValue("X-Test-User", out var user)
                ? AuthenticateResult.Success(new AuthenticationTicket(
                    new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user!)], "test")), "test"))
                : AuthenticateResult.NoResult());
    }

    private async Task<(WebApplication App, HttpClient Client)> StartAsync(bool withStorage = true, int photoUploadLimit = 10)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["RateLimiting:AuthPermitLimit"] = "100", ["RateLimiting:AuthWindowSeconds"] = "60",
            ["RateLimiting:GlobalPermitLimit"] = "1000", ["RateLimiting:GlobalWindowSeconds"] = "60",
            ["RateLimiting:FailedLoginLimit"] = "100", ["RateLimiting:PhotoUploadPermitLimit"] = photoUploadLimit.ToString(),
        });
        builder.Services.AddControllers().AddJsonOptions(ApiJson.Configure).AddApplicationPart(typeof(VehiclesController).Assembly);
        builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = c =>
            c.ProblemDetails.Extensions.TryAdd("code", GlobalExceptionHandler.FallbackCode(c.ProblemDetails.Status)));
        builder.Services.AddApplication();
        builder.Services.AddScoped<IAppDbContext>(_ => NewDb());
        if (withStorage)
        {
            builder.Services.AddSingleton<IFileStorage>(storage);
        }

        builder.Services.AddAuthentication("test").AddScheme<AuthenticationSchemeOptions, HeaderAuth>("test", null);
        builder.Services.AddAuthorization();
        builder.Services.AddRequestLimits(builder.Configuration);
        builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
        builder.Services.AddCors(o => o.AddPolicy("test", p => p.WithOrigins("http://client.test")));

        var app = builder.Build();
        app.UseExceptionHandler(_ => { });
        app.UseRequestLimits("test"); // the same call as Program.cs, authentication included
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();

        var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        client.DefaultRequestHeaders.Add("X-Test-User", userId.ToString());
        return (app, client);
    }

    private static MultipartFormDataContent Form(byte[] data, string fileName, string contentType = "image/jpeg")
    {
        var file = new ByteArrayContent(data);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new MultipartFormDataContent { { file, "file", fileName } };
    }

    private static async Task<(HttpStatusCode Status, JsonElement Body)> ReadAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement);
    }

    [Fact]
    public async Task Http_PngNamedJpgOver64KB_Uploads_TextNamedJpgIsUnsupported_NoFileIsRequired()
    {
        var car = await CarAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (okStatus, ok) = await ReadAsync(await client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(PngWithText(100_000), "car.jpg")));
        var (textStatus, text) = await ReadAsync(await client.PutAsync($"/api/vehicles/{car.Id}/photo",
            Form("not an image"u8.ToArray(), "car.jpg")));
        var (noneStatus, none) = await ReadAsync(await client.PutAsync($"/api/vehicles/{car.Id}/photo", new MultipartFormDataContent()));
        var (jsonStatus, json) = await ReadAsync(await client.PutAsync($"/api/vehicles/{car.Id}/photo",
            new StringContent("{}", Encoding.UTF8, "application/json")));

        Assert.Equal(HttpStatusCode.OK, okStatus);
        var key = Assert.Single(storage.Objects).Key;
        Assert.EndsWith(".png", key);
        Assert.Equal(Png1x1, storage.Objects[key].Content);
        Assert.Equal($"https://signed.test/{key}?expires=3600", ok.GetProperty("photoUrl").GetString());
        Assert.Equal((HttpStatusCode.BadRequest, "file.unsupportedType"), (textStatus, text.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.BadRequest, "file.required"), (noneStatus, none.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.BadRequest, "file.required"), (jsonStatus, json.GetProperty("code").GetString()));
    }

    [Theory]
    [InlineData(VehicleService.MaxPhotoBytes + 1)] // under the request limit: the service's own check
    [InlineData(VehicleService.MaxPhotoBytes + 200_000)] // over the request limit: Kestrel refuses the body (same code)
    public async Task Http_Over10MB_Is413FileTooLarge(int size)
    {
        var car = await CarAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;

        // Expect: 100-continue lets the server answer before the body is sent; without it the
        // test client may hit the connection reset Kestrel does after refusing a body.
        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/vehicles/{car.Id}/photo")
        {
            Content = Form([.. Png1x1, .. new byte[size - Png1x1.Length]], "big.png", "image/png"),
            Headers = { ExpectContinue = true }
        };
        var (status, body) = await ReadAsync(await client.SendAsync(request));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, status);
        Assert.Equal("file.tooLarge", body.GetProperty("code").GetString());
        Assert.Equal(VehicleService.MaxPhotoBytes, body.GetProperty("maxBytes").GetInt32());
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task Http_OtherEndpointsKeepThe64KBLimit()
    {
        var car = await CarAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (status, body) = await ReadAsync(await client.PutAsync($"/api/vehicles/{car.Id}",
            new StringContent($$"""{"nickname":"{{new string('a', 70_000)}}"}""", Encoding.UTF8, "application/json")));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, status);
        Assert.Equal("http.413", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Http_AnotherUsersCar_Is404_AndDeleteIs204()
    {
        var mine = await CarAsync();
        var theirs = await CarAsync(Guid.NewGuid());
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (upload, body) = await ReadAsync(await client.PutAsync($"/api/vehicles/{theirs.Id}/photo", Form(Png1x1, "car.png")));
        var (delete, _) = await ReadAsync(await client.DeleteAsync($"/api/vehicles/{theirs.Id}/photo"));
        await client.PutAsync($"/api/vehicles/{mine.Id}/photo", Form(Png1x1, "car.png"));
        var (deleteMine, _) = await ReadAsync(await client.DeleteAsync($"/api/vehicles/{mine.Id}/photo"));

        Assert.Equal((HttpStatusCode.NotFound, "vehicle.notFound"), (upload, body.GetProperty("code").GetString()));
        Assert.Equal(HttpStatusCode.NotFound, delete);
        Assert.Equal(HttpStatusCode.NoContent, deleteMine);
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task Http_WithoutStorage_PhotoEndpointsAre503_AndTheCarStillLoads()
    {
        var car = await CarAsync();
        var (app, client) = await StartAsync(withStorage: false);
        await using var _ = app;

        var (upload, body) = await ReadAsync(await client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png")));
        var (delete, deleteBody) = await ReadAsync(await client.DeleteAsync($"/api/vehicles/{car.Id}/photo"));
        var (get, dto) = await ReadAsync(await client.GetAsync($"/api/vehicles/{car.Id}"));

        Assert.Equal((HttpStatusCode.ServiceUnavailable, "file.storageUnavailable"), (upload, body.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.ServiceUnavailable, "file.storageUnavailable"), (delete, deleteBody.GetProperty("code").GetString()));
        Assert.Equal(HttpStatusCode.OK, get);
        Assert.Equal(JsonValueKind.Null, dto.GetProperty("photoUrl").ValueKind);
    }

    [Fact]
    public async Task Http_UploadsPerUserPerWindow_AreLimited_With429HttpCode_OtherUsersAndDeleteUnaffected()
    {
        var car = await CarAsync();
        var otherUser = Guid.NewGuid();
        var otherCar = await CarAsync(otherUser);
        var (app, client) = await StartAsync(photoUploadLimit: 2);
        await using var _ = app;

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png"))).StatusCode);
        var rejected = await client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png"));
        var other = new HttpRequestMessage(HttpMethod.Put, $"/api/vehicles/{otherCar.Id}/photo") { Content = Form(Png1x1, "car.png") };
        other.Headers.Add("X-Test-User", otherUser.ToString());
        client.DefaultRequestHeaders.Remove("X-Test-User");
        var otherResponse = await client.SendAsync(other);
        client.DefaultRequestHeaders.Add("X-Test-User", userId.ToString());
        var delete = await client.DeleteAsync($"/api/vehicles/{car.Id}/photo");

        var (status, body) = await ReadAsync(rejected);
        Assert.Equal((HttpStatusCode.TooManyRequests, "http.429"), (status, body.GetProperty("code").GetString()));
        Assert.InRange(int.Parse(rejected.Headers.GetValues("Retry-After").Single()), 1, 600);
        Assert.Equal(HttpStatusCode.OK, otherResponse.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
    }

    [Fact]
    public async Task Http_AThirdUploadWhileTwoAreRunning_Is429()
    {
        var car = await CarAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png"));
        var second = client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png"));
        var waited = Task.Run(async () =>
        {
            while (storage.Waiting < 2)
            {
                await Task.Delay(10);
            }
        });
        Assert.Same(waited, await Task.WhenAny(waited, Task.Delay(TimeSpan.FromSeconds(10))));

        var third = await client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png"));
        storage.PutGate.SetResult();

        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await first).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await second).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync($"/api/vehicles/{car.Id}/photo", Form(Png1x1, "car.png"))).StatusCode);
    }
}
