using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

/// <summary>FILE-2: receipt files on service records, on the in-memory storage fake (nothing touches R2).</summary>
public class AttachmentTests : FileTestBase
{
    private readonly MaintenanceTaskService tasks;

    public AttachmentTests() => tasks = new MaintenanceTaskService(db, vehicles);

    private static readonly byte[] Pdf = "%PDF-1.7\n%\u00e2\u00e3\n1 0 obj <</Author (Me) /GPS (32.08)>> endobj\n%%EOF\n"u8.ToArray();

    private static byte[] Webp()
    {
        byte[] body = [.. "WEBP"u8, .. "VP8L"u8, 5, 0, 0, 0, 0x2F, 0, 0, 0, 0, 0]; // one VP8L chunk, padded to even
        byte[] webp = [.. "RIFF"u8, 0, 0, 0, 0, .. body];
        BinaryPrimitives.WriteUInt32LittleEndian(webp.AsSpan(4), (uint)body.Length);
        return webp;
    }

    private async Task<(Guid Car, Guid Record)> RecordAsync(Guid? owner = null)
    {
        var car = await CarAsync(owner);
        var created = await tasks.CreateRecordAsync(owner ?? userId, car.Id, new CreateServiceRecordRequest(null, 1_000, "Shop", 50, null, null));
        return (car.Id, created.Record.Id);
    }

    private string Prefix(Guid car, Guid record) => $"users/{userId}/vehicles/{car}/service-records/{record}/";

    [Fact]
    public async Task Upload_EachType_StoredByContentUnderTheRecord_ListedWithAnInlineSignedUrl_NeverTheKey()
    {
        var (car, record) = await RecordAsync();

        await tasks.AddAttachmentAsync(userId, car, record, JpegWithGps(), "receipt.jpg");
        await tasks.AddAttachmentAsync(userId, car, record, Png1x1, "scan.pdf"); // a PNG named .pdf
        await tasks.AddAttachmentAsync(userId, car, record, Webp(), "photo");
        var dto = await tasks.AddAttachmentAsync(userId, car, record, Pdf, "חשבונית מס.pdf");

        var rows = db.Attachments.OrderBy(a => a.CreatedAt).ToList();
        Assert.Equal(["image/jpeg", "image/png", "image/webp", "application/pdf"], rows.Select(a => a.ContentType));
        Assert.Equal(["receipt.jpg", "scan.pdf", "photo", "חשבונית מס.pdf"], rows.Select(a => a.FileName));
        foreach (var (row, ext) in rows.Zip(new[] { "jpg", "png", "webp", "pdf" }))
        {
            Assert.Matches($"^{Prefix(car, record)}[0-9a-f]{{32}}\\.{ext}$", row.FileUrl);
            Assert.Equal(storage.Objects[row.FileUrl].Content.Length, row.SizeBytes);
            Assert.Equal(row.ContentType, storage.Objects[row.FileUrl].ContentType);
        }

        Assert.False(Contains(storage.Objects[rows[0].FileUrl].Content, "GPS-LAT"));
        Assert.Equal(Pdf, storage.Objects[rows[3].FileUrl].Content); // byte for byte, metadata and all

        Assert.Equal(rows.Select(a => a.Id), dto.Attachments.Select(a => a.Id));
        var pdf = dto.Attachments[3];
        Assert.Equal(("application/pdf", (long)Pdf.Length), (pdf.ContentType, pdf.SizeBytes));
        Assert.Equal($"https://signed.test/{rows[3].FileUrl}?expires=3600&type=application/pdf"
                     + "&disposition=inline; filename*=UTF-8''%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA%20%D7%9E%D7%A1.pdf", pdf.Url);
        Assert.Contains("&type=image/png&", dto.Attachments[1].Url); // the content's type, not the name's

        // The same list on the car page and /history; no field but the signed URL holds a key.
        var listed = Assert.Single(await tasks.ListRecordsAsync(userId, car));
        var searched = Assert.Single((await tasks.SearchRecordsAsync(userId, null, null, null, null, null, 0, 50)).Items);
        Assert.Equal(dto.Attachments, listed.Attachments);
        Assert.Equal(dto.Attachments, searched.Attachments);
        var json = JsonSerializer.Serialize(dto.Attachments.Select(a => a with { Url = null }));
        Assert.DoesNotContain("users/", json);
    }

    [Theory]
    [InlineData("not a pdf, just text")]
    [InlineData("%PDX-1.7")]
    [InlineData(" %PDF-1.7")]
    public async Task NotAnImageOrPdf_IsUnsupportedType_AndNothingIsStored(string text)
    {
        var (car, record) = await RecordAsync();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            tasks.AddAttachmentAsync(userId, car, record, Encoding.UTF8.GetBytes(text), "invoice.pdf"));

        Assert.Equal("file.unsupportedType", ex.Code);
        Assert.Empty(storage.Objects);
        Assert.Empty(db.Attachments);
    }

    [Fact]
    public async Task EmptyOrOver10MB_IsRejected_BeforeAnyUpload()
    {
        var (car, record) = await RecordAsync();
        byte[] tooBig = [.. Pdf, .. new byte[MaintenanceTaskService.MaxAttachmentBytes + 1 - Pdf.Length]];

        var empty = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.AddAttachmentAsync(userId, car, record, [], "a.pdf"));
        var missing = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.AddAttachmentAsync(userId, car, record, null, null));
        var large = await Assert.ThrowsAsync<PayloadTooLargeException>(() => tasks.AddAttachmentAsync(userId, car, record, tooBig, "a.pdf"));
        await tasks.AddAttachmentAsync(userId, car, record, tooBig[..^1], "exactly-10MB.pdf");

        Assert.Equal(("file.required", "file.required", "file.tooLarge"), (empty.Code, missing.Code, large.Code));
        Assert.Equal(MaintenanceTaskService.MaxAttachmentBytes, large.Extensions["maxBytes"]);
        Assert.Single(storage.Objects);
    }

    [Fact]
    public async Task TheEleventhFile_IsTooMany_CheckedBeforeTheFileItself()
    {
        var (car, record) = await RecordAsync();
        for (var i = 0; i < Attachment.MaxPerServiceRecord; i++)
        {
            await tasks.AddAttachmentAsync(userId, car, record, Pdf, $"{i}.pdf");
        }

        var eleventh = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.AddAttachmentAsync(userId, car, record, Pdf, "11.pdf"));
        var noFile = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.AddAttachmentAsync(userId, car, record, null, null));

        Assert.Equal(("attachment.tooMany", "attachment.tooMany"), (eleventh.Code, noFile.Code));
        Assert.Equal(10, eleventh.Extensions["maxCount"]);
        Assert.Equal(10, storage.Objects.Count);
    }

    [Fact]
    public async Task OverTheUserQuota_IsQuotaExceeded_AfterTheTypeCheck_PerUser_AndDeletingFreesSpace()
    {
        var limited = new MaintenanceTaskService(db, vehicles, Options.Create(new StorageOptions { UserQuotaBytes = 2 * Pdf.Length }));
        var (car, record) = await RecordAsync();
        var (otherCar, otherRecord) = await RecordAsync();
        var stranger = Guid.NewGuid();
        var (theirCar, theirRecord) = await RecordAsync(stranger);
        await limited.AddAttachmentAsync(userId, car, record, Pdf, "a.pdf");
        var atLimit = await limited.AddAttachmentAsync(userId, otherCar, otherRecord, Pdf, "b.pdf"); // exactly the quota, across cars

        var over = await Assert.ThrowsAsync<ValidationFailedException>(() => limited.AddAttachmentAsync(userId, car, record, Pdf, "c.pdf"));
        var wrongType = await Assert.ThrowsAsync<ValidationFailedException>(() => limited.AddAttachmentAsync(userId, car, record, [1, 2, 3], "c.pdf"));
        await limited.AddAttachmentAsync(stranger, theirCar, theirRecord, Pdf, "theirs.pdf");

        Assert.Equal(("file.quotaExceeded", "file.unsupportedType"), (over.Code, wrongType.Code));
        Assert.Equal(2L * Pdf.Length, over.Extensions["maxBytes"]);
        Assert.Equal(3, storage.Objects.Count);

        await limited.DeleteAttachmentAsync(userId, otherCar, otherRecord, atLimit.Attachments.Single().Id);
        await limited.AddAttachmentAsync(userId, car, record, Pdf, "c.pdf");
        Assert.Equal(1_073_741_824, new StorageOptions().UserQuotaBytes);
    }

    [Fact]
    public async Task AnotherUsersCarRecordOrAttachment_IsNotFound_AndUntouched()
    {
        var stranger = Guid.NewGuid();
        var (theirCar, theirRecord) = await RecordAsync(stranger);
        var theirs = (await tasks.AddAttachmentAsync(stranger, theirCar, theirRecord, Pdf, "theirs.pdf")).Attachments.Single();
        var (myCar, myRecord) = await RecordAsync();
        var mine = (await tasks.AddAttachmentAsync(userId, myCar, myRecord, Pdf, "mine.pdf")).Attachments.Single();

        var uploadTheirCar = await Assert.ThrowsAsync<NotFoundException>(() => tasks.AddAttachmentAsync(userId, theirCar, theirRecord, Pdf, "x.pdf"));
        var uploadTheirRecord = await Assert.ThrowsAsync<NotFoundException>(() => tasks.AddAttachmentAsync(userId, myCar, theirRecord, Pdf, "x.pdf"));
        var deleteTheirs = await Assert.ThrowsAsync<NotFoundException>(() => tasks.DeleteAttachmentAsync(userId, theirCar, theirRecord, theirs.Id));
        var deleteViaMyPath = await Assert.ThrowsAsync<NotFoundException>(() => tasks.DeleteAttachmentAsync(userId, myCar, myRecord, theirs.Id));
        var deleteUnknown = await Assert.ThrowsAsync<NotFoundException>(() => tasks.DeleteAttachmentAsync(userId, myCar, myRecord, Guid.NewGuid()));
        var mineByStranger = await Assert.ThrowsAsync<NotFoundException>(() => tasks.DeleteAttachmentAsync(stranger, myCar, myRecord, mine.Id));

        Assert.Equal(("vehicle.notFound", "serviceRecord.notFound"), (uploadTheirCar.Code, uploadTheirRecord.Code));
        Assert.All(new[] { deleteTheirs, deleteViaMyPath, deleteUnknown, mineByStranger }, e => Assert.Equal("attachment.notFound", e.Code));
        Assert.Equal(2, db.Attachments.Count());
        Assert.Equal(2, storage.Objects.Count);
        Assert.Equal("mine.pdf", Assert.Single(Assert.Single(await tasks.ListRecordsAsync(userId, myCar)).Attachments).FileName);
    }

    [Fact]
    public async Task Delete_RemovesRowAndObject_AndAFailedObjectDeleteIsNotAnError()
    {
        var (car, record) = await RecordAsync();
        await tasks.AddAttachmentAsync(userId, car, record, Pdf, "a.pdf");
        var dto = await tasks.AddAttachmentAsync(userId, car, record, Png1x1, "b.png");

        await tasks.DeleteAttachmentAsync(userId, car, record, dto.Attachments[0].Id);
        storage.FailDeletes = true;
        await tasks.DeleteAttachmentAsync(userId, car, record, dto.Attachments[1].Id);

        Assert.Empty(db.Attachments);
        Assert.EndsWith(".png", Assert.Single(storage.Objects).Key); // orphaned, logged
        Assert.Empty(Assert.Single(await tasks.ListRecordsAsync(userId, car)).Attachments);
    }

    [Fact]
    public async Task ArchivedCar_RejectsUploads_AllowsDelete()
    {
        var (car, record) = await RecordAsync();
        var dto = await tasks.AddAttachmentAsync(userId, car, record, Pdf, "a.pdf");
        await vehicles.ArchiveAsync(userId, car, archived: true);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.AddAttachmentAsync(userId, car, record, Pdf, "b.pdf"));
        await tasks.DeleteAttachmentAsync(userId, car, record, dto.Attachments[0].Id);

        Assert.Equal("attachment.vehicleArchived", ex.Code);
        Assert.Empty(storage.Objects);
        Assert.Empty(db.Attachments);
    }

    [Fact]
    public async Task Void_DeletesRowsThenObjects_EvenWhenAnObjectDeleteFails_AndTheVoidedRecordIsNotFound()
    {
        var (car, record) = await RecordAsync();
        var other = (await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(null, 2_000, null, null, null, null))).Record.Id;
        await tasks.AddAttachmentAsync(userId, car, record, Pdf, "a.pdf");
        await tasks.AddAttachmentAsync(userId, car, record, Png1x1, "b.png");
        await tasks.AddAttachmentAsync(userId, car, other, Pdf, "kept.pdf");

        await tasks.VoidAsync(userId, car, record);

        Assert.Equal("kept.pdf", Assert.Single(db.Attachments).FileName);
        Assert.StartsWith(Prefix(car, other), Assert.Single(storage.Objects).Key);
        var upload = await Assert.ThrowsAsync<NotFoundException>(() => tasks.AddAttachmentAsync(userId, car, record, Pdf, "c.pdf"));
        Assert.Equal("serviceRecord.notFound", upload.Code);

        storage.FailDeletes = true;
        await tasks.VoidAsync(userId, car, other);
        Assert.Empty(db.Attachments);
        Assert.Single(storage.Objects); // orphaned, logged; the void itself succeeded
        Assert.True(db.ServiceRecords.Single(r => r.Id == other).IsVoided);
    }

    [Fact]
    public async Task Edit_LeavesAttachmentsAlone_AndItsResponseListsThem()
    {
        var (car, record) = await RecordAsync();
        await tasks.AddAttachmentAsync(userId, car, record, Pdf, "a.pdf");

        var edited = await tasks.UpdateRecordAsync(userId, car, record, new UpdateServiceRecordRequest("Other shop", 75, "notes", null));

        Assert.Equal("a.pdf", Assert.Single(edited.Record.Attachments).FileName);
        Assert.Single(db.Attachments);
        Assert.Single(storage.Objects);
    }

    [Fact]
    public async Task AStoredKeyOutsideTheRecordsPrefix_IsNeverSignedOrDeleted()
    {
        var (car, record) = await RecordAsync();
        var otherRecord = (await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(null, 2_000, null, null, null, null))).Record.Id;
        var foreign = new[]
        {
            $"users/{Guid.NewGuid()}/vehicles/{car}/service-records/{record}/{Guid.NewGuid():N}.pdf",
            $"users/{userId}/vehicles/{car}/service-records/{otherRecord}/{Guid.NewGuid():N}.pdf",
            $"users/{userId}/vehicles/{car}/photo/{Guid.NewGuid():N}.jpg",
            $"{Prefix(car, record)}../../../../x.pdf",
            $"{Prefix(car, record)}{Guid.NewGuid():N}.html",
            $"{Prefix(car, record)}{Guid.NewGuid():N}.pdf\n"
        };

        foreach (var key in foreign)
        {
            storage.Objects[key] = ([1], "application/pdf");
            db.Attachments.Add(new Attachment { ServiceRecordId = record, FileUrl = key, FileName = "x.pdf", ContentType = "application/pdf", SizeBytes = 1 });
        }
        await db.SaveChangesAsync();

        var listed = Assert.Single(await tasks.ListRecordsAsync(userId, car, CancellationToken.None), r => r.Id == record);
        Assert.Equal(foreign.Length, listed.Attachments.Count);
        Assert.All(listed.Attachments, a => Assert.Null(a.Url));

        await tasks.DeleteAttachmentAsync(userId, car, record, listed.Attachments[0].Id);
        await tasks.VoidAsync(userId, car, record);
        Assert.Empty(db.Attachments.Where(a => a.ServiceRecordId == record));
        Assert.All(foreign, key => Assert.True(storage.Objects.ContainsKey(key), key));
    }

    [Fact]
    public async Task WithoutStorage_BothCallsAre503_UrlsAreNull_AndVoidStillWorks()
    {
        var (car, record) = await RecordAsync();
        var dto = await tasks.AddAttachmentAsync(userId, car, record, Pdf, "a.pdf");
        var noStorage = new MaintenanceTaskService(db, new VehicleService(db));

        var upload = await Assert.ThrowsAsync<ServiceUnavailableException>(() => noStorage.AddAttachmentAsync(userId, car, record, Pdf, "b.pdf"));
        var delete = await Assert.ThrowsAsync<ServiceUnavailableException>(() =>
            noStorage.DeleteAttachmentAsync(userId, car, record, dto.Attachments[0].Id));
        var listed = Assert.Single(Assert.Single(await noStorage.ListRecordsAsync(userId, car)).Attachments);

        Assert.Equal(("file.storageUnavailable", "file.storageUnavailable"), (upload.Code, delete.Code));
        Assert.Equal(("a.pdf", (string?)null), (listed.FileName, listed.Url));
        await noStorage.VoidAsync(userId, car, record);
        Assert.Empty(db.Attachments);
    }

    [Theory]
    [InlineData("receipt.pdf", "receipt.pdf")]
    [InlineData(@"C:\Users\me\Desktop\receipt.pdf", "receipt.pdf")]
    [InlineData("../../etc/passwd.png", "passwd.png")]
    [InlineData("  spaced.pdf  ", "spaced.pdf")]
    [InlineData("invoice\u202Efdp.exe", "invoicefdp.exe")] // RLO would show it as "invoiceexe.pdf"
    [InlineData("a\u200E\u200F\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069\u061Cb.pdf", "ab.pdf")]
    [InlineData("tab\there\u0000\u001F\u007F\u0085\u009F.pdf", "tabhere.pdf")]
    [InlineData("\uFEFFbom\u200B\u200C\u200D\u2060zero\u2028\u2029width.pdf", "bomzerowidth.pdf")] // BOM, zero-width, line separators
    [InlineData("חשבונית.pdf", "חשבונית.pdf")]
    [InlineData("", "receipt.pdf")]
    [InlineData(null, "receipt.pdf")]
    [InlineData("folder/", "receipt.pdf")]
    [InlineData(" \u202E ", "receipt.pdf")]
    public void FileName_IsCleaned(string? name, string expected) =>
        Assert.Equal(expected, MaintenanceTaskService.CleanFileName(name, "pdf"));

    [Fact]
    public void FileName_LongerThan255_IsCutKeepingTheExtension_WithoutSplittingASurrogatePair()
    {
        var plain = MaintenanceTaskService.CleanFileName(new string('a', 300) + ".pdf", "pdf");
        var emoji = MaintenanceTaskService.CleanFileName(new string('a', 249) + "😀😀😀.jpeg", "jpg");
        var hugeExtension = MaintenanceTaskService.CleanFileName("a." + new string('b', 300), "pdf");

        Assert.Equal(new string('a', 251) + ".pdf", plain);
        Assert.Equal(new string('a', 249) + ".jpeg", emoji); // the cut at 250 falls inside the first emoji
        Assert.Equal(255, hugeExtension.Length);
        Assert.All(new[] { plain, emoji, hugeExtension }, n => Assert.True(n.Length <= 255));
    }

    // ---- HTTP: the real controllers on Kestrel.

    private string AttachmentsPath(Guid car, Guid record) => $"/api/vehicles/{car}/service-records/{record}/attachments";

    [Fact]
    public async Task Http_UploadOver64KB_ListAndDelete_TextIsUnsupported_NoFileIsRequired()
    {
        var (car, record) = await RecordAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (okStatus, ok) = await ReadAsync(await client.PostAsync(AttachmentsPath(car, record), Form(PngWithText(100_000), "קבלה.pdf", "application/pdf")));
        var (textStatus, text) = await ReadAsync(await client.PostAsync(AttachmentsPath(car, record), Form("plain text"u8.ToArray(), "x.pdf")));
        var (noneStatus, none) = await ReadAsync(await client.PostAsync(AttachmentsPath(car, record), new MultipartFormDataContent()));
        var (_, list) = await ReadAsync(await client.GetAsync($"/api/vehicles/{car}/service-records"));

        Assert.Equal(HttpStatusCode.OK, okStatus);
        var attachment = Assert.Single(ok.GetProperty("attachments").EnumerateArray());
        Assert.Equal("קבלה.pdf", attachment.GetProperty("fileName").GetString());
        Assert.Equal("image/png", attachment.GetProperty("contentType").GetString());
        Assert.Equal(Png1x1.Length, attachment.GetProperty("sizeBytes").GetInt64());
        Assert.StartsWith("https://signed.test/users/", attachment.GetProperty("url").GetString());
        Assert.Equal(["id", "fileName", "contentType", "sizeBytes", "url"], attachment.EnumerateObject().Select(p => p.Name));
        Assert.Equal(attachment.GetRawText(), list[0].GetProperty("attachments")[0].GetRawText());
        Assert.Equal((HttpStatusCode.BadRequest, "file.unsupportedType"), (textStatus, text.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.BadRequest, "file.required"), (noneStatus, none.GetProperty("code").GetString()));

        var delete = await client.DeleteAsync($"{AttachmentsPath(car, record)}/{attachment.GetProperty("id").GetString()}");
        var (again, againBody) = await ReadAsync(await client.DeleteAsync($"{AttachmentsPath(car, record)}/{attachment.GetProperty("id").GetString()}"));
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Equal((HttpStatusCode.NotFound, "attachment.notFound"), (again, againBody.GetProperty("code").GetString()));
        Assert.Empty(storage.Objects);
    }

    [Theory]
    [InlineData(MaintenanceTaskService.MaxAttachmentBytes + 1)] // the service's own check
    [InlineData(12_000_000)] // over the request limit: Kestrel refuses the body (same code)
    public async Task Http_Over10MB_Is413FileTooLarge(int size)
    {
        var (car, record) = await RecordAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;

        var request = new HttpRequestMessage(HttpMethod.Post, AttachmentsPath(car, record))
        {
            Content = Form([.. Pdf, .. new byte[size - Pdf.Length]], "big.pdf", "application/pdf"),
            Headers = { ExpectContinue = true }
        };
        var (status, body) = await ReadAsync(await client.SendAsync(request));

        Assert.Equal((HttpStatusCode.RequestEntityTooLarge, "file.tooLarge"), (status, body.GetProperty("code").GetString()));
        Assert.Equal(MaintenanceTaskService.MaxAttachmentBytes, body.GetProperty("maxBytes").GetInt32());
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task Http_TheServiceRecordEndpointsKeepThe64KBLimit()
    {
        var (car, record) = await RecordAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (status, body) = await ReadAsync(await client.PutAsync($"/api/vehicles/{car}/service-records/{record}",
            new StringContent($$"""{"notes":"{{new string('a', 70_000)}}"}""", Encoding.UTF8, "application/json")));

        Assert.Equal((HttpStatusCode.RequestEntityTooLarge, "http.413"), (status, body.GetProperty("code").GetString()));
    }

    [Fact]
    public async Task Http_PhotoAndAttachments_ShareOneUploadBudget_DeleteIsNotLimited()
    {
        var (car, record) = await RecordAsync();
        var (app, client) = await StartAsync(uploadLimit: 2);
        await using var _ = app;

        var photo = await client.PutAsync($"/api/vehicles/{car}/photo", Form(Png1x1, "car.png"));
        var first = await client.PostAsync(AttachmentsPath(car, record), Form(Pdf, "a.pdf"));
        var (status, body) = await ReadAsync(await client.PostAsync(AttachmentsPath(car, record), Form(Pdf, "b.pdf")));
        var id = (await ReadAsync(first)).Body.GetProperty("attachments")[0].GetProperty("id").GetString();
        var delete = await client.DeleteAsync($"{AttachmentsPath(car, record)}/{id}");

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (photo.StatusCode, first.StatusCode));
        Assert.Equal((HttpStatusCode.TooManyRequests, "http.429"), (status, body.GetProperty("code").GetString()));
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
    }

    [Fact]
    public async Task Http_WithoutStorage_BothEndpointsAre503_AndTheListHasNullUrls()
    {
        var (car, record) = await RecordAsync();
        var dto = await tasks.AddAttachmentAsync(userId, car, record, Pdf, "a.pdf");
        var (app, client) = await StartAsync(withStorage: false);
        await using var _ = app;

        var (upload, uploadBody) = await ReadAsync(await client.PostAsync(AttachmentsPath(car, record), Form(Pdf, "b.pdf")));
        var (delete, deleteBody) = await ReadAsync(await client.DeleteAsync($"{AttachmentsPath(car, record)}/{dto.Attachments[0].Id}"));
        var (list, records) = await ReadAsync(await client.GetAsync($"/api/vehicles/{car}/service-records"));

        Assert.Equal((HttpStatusCode.ServiceUnavailable, "file.storageUnavailable"), (upload, uploadBody.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.ServiceUnavailable, "file.storageUnavailable"), (delete, deleteBody.GetProperty("code").GetString()));
        Assert.Equal(HttpStatusCode.OK, list);
        Assert.Equal(JsonValueKind.Null, records[0].GetProperty("attachments")[0].GetProperty("url").ValueKind);
    }
}
