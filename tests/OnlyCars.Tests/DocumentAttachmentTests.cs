using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using OnlyCars.Api.Controllers;
using OnlyCars.Application.Account;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Reminders;
using OnlyCars.Application.Reminders.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

/// <summary>SCAN-2a: files on vehicle documents, on the in-memory storage fake. Criterion numbers refer to the ticket; races are in MaintenanceSchemaTests.</summary>
public class DocumentAttachmentTests : FileTestBase
{
    private static readonly byte[] Pdf = AttachmentTests.Pdf;
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow); // a fixed day fails the "date must be today" rule two days later
    private readonly VehicleDocumentService documents;

    public DocumentAttachmentTests() => documents = new VehicleDocumentService(db, vehicles);

    private async Task<(Guid Car, Guid Document)> DocumentAsync(Guid? owner = null, VehicleDocumentService? service = null)
    {
        var car = await CarAsync(owner);
        var created = await (service ?? documents).CreateAsync(owner ?? userId, car.Id,
            new VehicleDocumentRequest("Insurance", Today.AddDays(30), 1_200, null), Today);
        Assert.Empty(created.Attachments); // criterion 4: the create response has the list too
        return (car.Id, created.Id);
    }

    private string Prefix(Guid car, Guid document) => $"users/{userId}/vehicles/{car}/documents/{document}/";

    private Task<VehicleDocumentDto> AddAsync(Guid car, Guid document, byte[] content, string? name, Guid? owner = null,
        VehicleDocumentService? service = null) =>
        (service ?? documents).AddAttachmentAsync(owner ?? userId, car, document, content, name, Today);

    // --- Criterion 2 ---

    [Fact]
    public async Task Upload_ImageAndPdf_StoredUnderTheDocument_ListedOldestFirst_WithSignedUrls_AndTheStatusFields()
    {
        var (car, document) = await DocumentAsync();

        await AddAsync(car, document, JpegWithGps(), "policy.jpg");
        var dto = await AddAsync(car, document, Pdf, null);

        Assert.Equal((DocumentStatus.Expiring, 30), (dto.Status, dto.DaysLeft)); // within the default 30 lead days
        Assert.Equal(["policy.jpg", "document.pdf"], dto.Attachments.Select(a => a.FileName)); // the fallback name for documents
        var rows = db.Attachments.OrderBy(a => a.CreatedAt).ToList();
        Assert.All(rows, r => Assert.Equal((document, (Guid?)null, (Guid?)null), (r.VehicleDocumentId!.Value, r.ServiceRecordId, r.ChecklistRunId)));
        Assert.Matches($"^{Prefix(car, document)}[0-9a-f]{{32}}\\.jpg$", rows[0].FileUrl);
        Assert.False(Contains(storage.Objects[rows[0].FileUrl].Content, "GPS-LAT")); // metadata removed, as on services
        Assert.Equal(Pdf, storage.Objects[rows[1].FileUrl].Content);
        Assert.StartsWith($"https://signed.test/{rows[1].FileUrl}?expires=3600&type=application/pdf&disposition=inline", dto.Attachments[1].Url);

        var listed = Assert.Single(await documents.ListAsync(userId, car, Today));
        Assert.Equal(dto.Attachments, listed.Attachments);
    }

    [Fact]
    public async Task AnotherUsersCarOrDocument_OrAMismatchedPath_IsNotFound_AndUntouched()
    {
        var stranger = Guid.NewGuid();
        var (theirCar, theirDoc) = await DocumentAsync(stranger);
        var theirs = (await AddAsync(theirCar, theirDoc, Pdf, "theirs.pdf", stranger)).Attachments.Single();
        var (myCar, myDoc) = await DocumentAsync();
        var (_, myOtherDoc) = await DocumentAsync();
        var mine = (await AddAsync(myCar, myDoc, Pdf, "mine.pdf")).Attachments.Single();

        var theirCarUpload = await Assert.ThrowsAsync<NotFoundException>(() => AddAsync(theirCar, theirDoc, Pdf, "x.pdf"));
        var theirDocUpload = await Assert.ThrowsAsync<NotFoundException>(() => AddAsync(myCar, theirDoc, Pdf, "x.pdf"));
        var otherCarsDoc = await Assert.ThrowsAsync<NotFoundException>(() => AddAsync(myCar, myOtherDoc, Pdf, "x.pdf"));
        var deletes = new[]
        {
            () => documents.DeleteAttachmentAsync(userId, theirCar, theirDoc, theirs.Id),
            () => documents.DeleteAttachmentAsync(userId, myCar, myDoc, theirs.Id),
            () => documents.DeleteAttachmentAsync(userId, myCar, myOtherDoc, mine.Id), // another document's path
            () => documents.DeleteAttachmentAsync(userId, myCar, myDoc, Guid.NewGuid()),
            () => documents.DeleteAttachmentAsync(stranger, myCar, myDoc, mine.Id)
        };

        Assert.Equal(("vehicle.notFound", "vehicleDocument.notFound", "vehicleDocument.notFound"),
            (theirCarUpload.Code, theirDocUpload.Code, otherCarsDoc.Code));
        foreach (var delete in deletes)
        {
            Assert.Equal("attachment.notFound", (await Assert.ThrowsAsync<NotFoundException>(delete)).Code);
        }
        Assert.Equal(2, db.Attachments.Count());
        Assert.Equal(2, storage.Objects.Count);
    }

    [Fact]
    public async Task TheEleventhFile_IsTooMany_ATextFileIsUnsupported_EmptyIsRequired_Over10MBIsTooLarge()
    {
        var (car, document) = await DocumentAsync();
        for (var i = 0; i < Attachment.MaxPerParent; i++)
        {
            await AddAsync(car, document, Pdf, $"{i}.pdf");
        }

        var eleventh = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, document, Pdf, "11.pdf"));
        var (otherCar, other) = await DocumentAsync();
        var text = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(otherCar, other, "hello"u8.ToArray(), "a.pdf"));
        var empty = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(otherCar, other, [], "a.pdf"));
        var large = await Assert.ThrowsAsync<PayloadTooLargeException>(() => AddAsync(otherCar, other, new byte[AttachmentFiles.MaxBytes + 1], "a.pdf"));

        Assert.Equal(("attachment.tooMany", 10), (eleventh.Code, (int)eleventh.Extensions["maxCount"]!));
        Assert.Equal(("file.unsupportedType", "file.required", "file.tooLarge"), (text.Code, empty.Code, large.Code));
        Assert.Equal(10, storage.Objects.Count);
    }

    [Fact]
    public async Task ArchivedCar_RefusesUploads_AllowsDeletingAFile_ButTheDocumentItselfStaysReadOnly()
    {
        var (car, document) = await DocumentAsync();
        var file = (await AddAsync(car, document, Pdf, "a.pdf")).Attachments.Single();
        await vehicles.ArchiveAsync(userId, car, archived: true);

        var upload = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, document, Pdf, "b.pdf"));
        await documents.DeleteAttachmentAsync(userId, car, document, file.Id);
        var deleteDocument = await Assert.ThrowsAsync<ValidationFailedException>(() => documents.DeleteAsync(userId, car, document));

        Assert.Equal(("attachment.vehicleArchived", "vehicleDocument.vehicleArchived"), (upload.Code, deleteDocument.Code));
        Assert.Empty(db.Attachments);
        Assert.Empty(storage.Objects);
        Assert.Empty(Assert.Single(await documents.ListAsync(userId, car, Today)).Attachments); // listing an archived car still works
    }

    [Fact]
    public async Task WithoutStorage_BothCallsAre503_AheadOf404()
    {
        var noStorage = new VehicleDocumentService(db, new VehicleService(db));

        var upload = await Assert.ThrowsAsync<ServiceUnavailableException>(() => AddAsync(Guid.NewGuid(), Guid.NewGuid(), Pdf, "a.pdf", service: noStorage));
        var delete = await Assert.ThrowsAsync<ServiceUnavailableException>(() =>
            noStorage.DeleteAttachmentAsync(userId, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()));

        Assert.Equal(("file.storageUnavailable", "file.storageUnavailable"), (upload.Code, delete.Code));
    }

    // --- Criterion 3 ---

    [Fact]
    public async Task Quota_CountsDocumentFilesWithServiceFilesAndRunPhotos_OnAllThreeEndpoints()
    {
        var options = Options.Create(new StorageOptions { UserQuotaBytes = 2 * Png1x1.Length });
        var limitedDocs = new VehicleDocumentService(db, vehicles, options);
        var limitedTasks = new MaintenanceTaskService(db, vehicles, options);
        var limitedRuns = new VehicleChecklistService(db, vehicles, options);
        var (car, document) = await DocumentAsync();
        var record = (await limitedTasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(null, 1_000, null, null, null, null))).Record.Id;
        var template = await new ChecklistTemplateService(db).CreateAsync(userId, new ChecklistTemplateRequest("Walk", [new(null, "Lights", "Check", null, null, null)]));
        var checklist = await limitedRuns.AttachAsync(userId, car, new AttachChecklistRequest(template.Id, null, null, null));
        var run = (await limitedRuns.CreateRunAsync(userId, checklist.Id,
            new CreateChecklistRunRequest(null, null, null, [new ChecklistRunItemRequest(template.Items[0].Id, true, null, null)]))).Run.Id;
        var stranger = Guid.NewGuid();
        var (theirCar, theirDoc) = await DocumentAsync(stranger);

        // Document files fill the quota: the service and run uploads are over, and so is another document file.
        await AddAsync(car, document, Png1x1, "a.png", service: limitedDocs);
        var file = (await AddAsync(car, document, Png1x1, "b.png", service: limitedDocs)).Attachments[1];
        var onRecord = await Assert.ThrowsAsync<ValidationFailedException>(() => limitedTasks.AddAttachmentAsync(userId, car, record, Pdf, "r.pdf"));
        var onRun = await Assert.ThrowsAsync<ValidationFailedException>(() => limitedRuns.AddRunAttachmentAsync(userId, run, Png1x1, "p.png"));
        var onDocument = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, document, Pdf, "c.pdf", service: limitedDocs));
        await AddAsync(theirCar, theirDoc, Png1x1, "theirs.png", stranger, limitedDocs); // per user

        Assert.All(new[] { onRecord, onRun, onDocument }, e => Assert.Equal("file.quotaExceeded", e.Code));
        Assert.Equal(2L * Png1x1.Length, onDocument.Extensions["maxBytes"]);

        // The reverse: a service file fills the space a document file freed, and the document upload is over.
        await limitedDocs.DeleteAttachmentAsync(userId, car, document, file.Id);
        await limitedTasks.AddAttachmentAsync(userId, car, record, Png1x1, "r.png");
        var reverse = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, document, Pdf, "c.pdf", service: limitedDocs));
        Assert.Equal("file.quotaExceeded", reverse.Code);
    }

    // --- Criterion 4 ---

    [Fact]
    public async Task DeleteDocument_DeletesItsRowsThenObjects_OtherDocumentsKeepTheirs_AndAFailedObjectDeleteIsNotAnError()
    {
        var (car, document) = await DocumentAsync();
        var (keptCar, kept) = await DocumentAsync();
        await AddAsync(car, document, Pdf, "a.pdf");
        await AddAsync(car, document, Png1x1, "b.png");
        await AddAsync(keptCar, kept, Pdf, "kept.pdf");

        await documents.DeleteAsync(userId, car, document);

        Assert.Equal("kept.pdf", Assert.Single(db.Attachments).FileName);
        Assert.StartsWith(Prefix(keptCar, kept), Assert.Single(storage.Objects).Key);
        var upload = await Assert.ThrowsAsync<NotFoundException>(() => AddAsync(car, document, Pdf, "c.pdf"));
        Assert.Equal("vehicleDocument.notFound", upload.Code);

        storage.FailDeletes = true;
        await documents.DeleteAsync(userId, keptCar, kept);
        Assert.Empty(db.Attachments);
        Assert.Empty(db.VehicleDocuments);
        Assert.Single(storage.Objects); // orphaned, logged; the delete itself succeeded
    }

    [Fact]
    public async Task RenewingOrEditing_KeepsTheFiles_AndTheResponseListsThem()
    {
        var (car, document) = await DocumentAsync();
        await AddAsync(car, document, Pdf, "policy.pdf");

        var renewed = await documents.UpdateAsync(userId, car, document, new VehicleDocumentRequest("Insurance", Today.AddYears(1), 1_300, "new policy"), Today);

        Assert.Equal("policy.pdf", Assert.Single(renewed.Attachments).FileName);
        Assert.Single(db.Attachments);
        Assert.Single(storage.Objects);
    }

    [Fact]
    public async Task Reminders_AreUnchanged_ADocumentWithFilesIsStillListed()
    {
        var car = await CarAsync();
        var expiring = await documents.CreateAsync(userId, car.Id, new VehicleDocumentRequest("Inspection", Today.AddDays(3), null, null), Today);
        await AddAsync(car.Id, expiring.Id, Pdf, "a.pdf");

        var reminder = Assert.Single((await new ReminderService(db).GetAsync(userId, Today)).Items);

        Assert.Equal((expiring.Id, 3), (reminder.RefId, reminder.RemainingDays));
    }

    // --- Criterion 5 ---

    [Fact]
    public async Task Zip_HoldsDocumentFilesUnderTheirFolder_AMissingOneIsListed()
    {
        db.Users.Add(new User { Id = userId, Email = "me@onlycars.test", PasswordHash = "x" });
        var (car, document) = await DocumentAsync();
        await AddAsync(car, document, Pdf, "פוליסה.pdf");
        var lost = (await AddAsync(car, document, Png1x1, "lost.png")).Attachments[1];
        storage.Objects.Remove(db.Attachments.Single(a => a.Id == lost.Id).FileUrl);

        var output = new MemoryStream();
        await new FullExportService(db, new ExportService(db), new ExportLinks(), storage).WriteZipAsync(userId, output, MeController.ExportJson);
        output.Position = 0;
        using var zip = new ZipArchive(output, ZipArchiveMode.Read);

        var folder = $"cars/Corolla/documents/Insurance {Today.AddDays(30):yyyy-MM-dd} {document.ToString()[..8]}/";
        Assert.Equal(["data.json", folder + "פוליסה.pdf", "missing-files.txt"], zip.Entries.Select(e => e.FullName));
        using var copy = new MemoryStream();
        zip.GetEntry(folder + "פוליסה.pdf")!.Open().CopyTo(copy);
        Assert.Equal(Pdf, copy.ToArray());
        Assert.Equal($"{folder}lost.png - not found in storage{Environment.NewLine}",
            new StreamReader(zip.GetEntry("missing-files.txt")!.Open(), Encoding.UTF8).ReadToEnd());
        var data = JsonDocument.Parse(zip.GetEntry("data.json")!.Open()).RootElement;
        var files = data.GetProperty("vehicles")[0].GetProperty("documents")[0].GetProperty("attachments").EnumerateArray()
            .Select(f => f.GetProperty("path").GetString()).ToList();
        Assert.Equal([folder + "פוליסה.pdf", folder + "lost.png"], files);
    }

    // --- HTTP: the real controller on Kestrel ---

    private static string FilesPath(Guid car, Guid document) => $"/api/vehicles/{car}/documents/{document}/attachments";

    [Fact]
    public async Task Http_Upload200WithTheDocument_Delete204_ErrorsAreCoded_AndTheListHasTheFiles()
    {
        var (car, document) = await DocumentAsync();
        var (theirCar, theirDoc) = await DocumentAsync(Guid.NewGuid());
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (okStatus, ok) = await ReadAsync(await client.PostAsync($"{FilesPath(car, document)}?today={Today:yyyy-MM-dd}",
            Form(PngWithText(100_000), "רישיון.png", "image/png")));
        var (textStatus, text) = await ReadAsync(await client.PostAsync(FilesPath(car, document), Form("plain"u8.ToArray(), "x.pdf")));
        var (theirStatus, their) = await ReadAsync(await client.PostAsync(FilesPath(theirCar, theirDoc), Form(Pdf, "x.pdf")));
        var big = new HttpRequestMessage(HttpMethod.Post, FilesPath(car, document))
            { Content = Form(new byte[12_000_000], "big.pdf"), Headers = { ExpectContinue = true } };
        var (bigStatus, bigBody) = await ReadAsync(await client.SendAsync(big));
        var (_, list) = await ReadAsync(await client.GetAsync($"/api/vehicles/{car}/documents?today={Today:yyyy-MM-dd}"));

        Assert.Equal(HttpStatusCode.OK, okStatus);
        Assert.Equal((document.ToString(), 30), (ok.GetProperty("id").GetString(), ok.GetProperty("daysLeft").GetInt32()));
        var file = Assert.Single(ok.GetProperty("attachments").EnumerateArray());
        Assert.Equal(["id", "fileName", "contentType", "sizeBytes", "url"], file.EnumerateObject().Select(p => p.Name));
        Assert.Equal(("רישיון.png", "image/png"), (file.GetProperty("fileName").GetString(), file.GetProperty("contentType").GetString()));
        Assert.Equal(file.GetRawText(), list[0].GetProperty("attachments")[0].GetRawText());
        Assert.Equal((HttpStatusCode.BadRequest, "file.unsupportedType"), (textStatus, text.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.NotFound, "vehicle.notFound"), (theirStatus, their.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.RequestEntityTooLarge, "file.tooLarge"), (bigStatus, bigBody.GetProperty("code").GetString()));

        var path = $"{FilesPath(car, document)}/{file.GetProperty("id").GetString()}";
        var delete = await client.DeleteAsync(path);
        var (again, againBody) = await ReadAsync(await client.DeleteAsync(path));
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Equal((HttpStatusCode.NotFound, "attachment.notFound"), (again, againBody.GetProperty("code").GetString()));
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task Http_DocumentFilesShareTheUploadBudgetWithServiceFiles_DeleteIsNotLimited()
    {
        var (car, document) = await DocumentAsync();
        var record = (await new MaintenanceTaskService(db, vehicles).CreateRecordAsync(userId, car,
            new CreateServiceRecordRequest(null, 1_000, null, null, null, null))).Record.Id;
        var (app, client) = await StartAsync(uploadLimit: 2);
        await using var _ = app;

        var first = await client.PostAsync($"/api/vehicles/{car}/service-records/{record}/attachments", Form(Pdf, "a.pdf"));
        var second = await client.PostAsync(FilesPath(car, document), Form(Pdf, "b.pdf"));
        var (status, body) = await ReadAsync(await client.PostAsync(FilesPath(car, document), Form(Pdf, "c.pdf")));
        var id = (await ReadAsync(second)).Body.GetProperty("attachments")[0].GetProperty("id").GetString();
        var delete = await client.DeleteAsync($"{FilesPath(car, document)}/{id}");

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (first.StatusCode, second.StatusCode));
        Assert.Equal((HttpStatusCode.TooManyRequests, "http.429"), (status, body.GetProperty("code").GetString()));
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
    }
}
