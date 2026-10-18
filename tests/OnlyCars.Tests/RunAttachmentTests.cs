using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

/// <summary>FILE-3: photos on checklist runs, on the in-memory storage fake (nothing touches R2). Criterion numbers refer to the ticket.</summary>
public class RunAttachmentTests : FileTestBase
{
    private static readonly byte[] Pdf = AttachmentTests.Pdf;
    private readonly ChecklistTemplateService templates;
    private readonly VehicleChecklistService checklists;
    private readonly MaintenanceTaskService tasks;

    public RunAttachmentTests()
    {
        templates = new ChecklistTemplateService(db);
        checklists = new VehicleChecklistService(db, vehicles);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    private sealed record Run(Guid Car, Guid Checklist, Guid Template, Guid Id);

    // One Check item; the car gets the checklist and one run.
    private async Task<Run> RunAsync(Guid? owner = null, VehicleChecklistService? service = null)
    {
        var user = owner ?? userId;
        var car = await CarAsync(owner);
        var template = await templates.CreateAsync(user, new ChecklistTemplateRequest($"Check {Guid.NewGuid():N}", [new(null, "Lights", "Check", null, null, null)]));
        var checklist = await (service ?? checklists).AttachAsync(user, car.Id, new AttachChecklistRequest(template.Id, null, null, null));
        var run = await (service ?? checklists).CreateRunAsync(user, checklist.Id,
            new CreateChecklistRunRequest(null, null, null, [new ChecklistRunItemRequest(template.Items[0].Id, true, null, null)]));
        Assert.Empty(run.Run.Attachments);
        return new(car.Id, checklist.Id, template.Id, run.Run.Id);
    }

    private string Prefix(Run run) => $"users/{userId}/vehicles/{run.Car}/checklist-runs/{run.Id}/";

    private async Task<ChecklistRunDto> ListedAsync(Run run, VehicleChecklistService? service = null) =>
        Assert.Single(await (service ?? checklists).ListRunsAsync(userId, run.Checklist), r => r.Id == run.Id);

    // --- Criteria 1 and 2 ---

    [Fact]
    public async Task Upload_JpegPngWebp_StoredWithoutMetadataUnderTheRun_ListedInTheRunHistory_NeverTheKey()
    {
        var run = await RunAsync();

        await checklists.AddRunAttachmentAsync(userId, run.Id, JpegWithGps(), "tyre.jpg");
        await checklists.AddRunAttachmentAsync(userId, run.Id, PngWithText(), "leak.png");
        var dto = await checklists.AddRunAttachmentAsync(userId, run.Id, AttachmentTests.Webp(), "  ");

        var rows = db.Attachments.OrderBy(a => a.CreatedAt).ToList();
        Assert.All(rows, a => Assert.Equal((run.Id, (Guid?)null), (a.ChecklistRunId!.Value, a.ServiceRecordId)));
        Assert.Equal(["image/jpeg", "image/png", "image/webp"], rows.Select(a => a.ContentType));
        Assert.Equal(["tyre.jpg", "leak.png", "photo.webp"], rows.Select(a => a.FileName));
        foreach (var (row, ext) in rows.Zip(new[] { "jpg", "png", "webp" }))
        {
            Assert.Matches($"^{Prefix(run)}[0-9a-f]{{32}}\\.{ext}$", row.FileUrl);
            Assert.Equal(storage.Objects[row.FileUrl].Content.Length, row.SizeBytes);
        }

        Assert.False(Contains(storage.Objects[rows[0].FileUrl].Content, "GPS-LAT"));
        Assert.False(Contains(storage.Objects[rows[1].FileUrl].Content, "SECRET-TEXT"));

        // The upload response is the run as the history lists it, items included.
        Assert.Equal(rows.Select(a => a.Id), dto.Attachments.Select(a => a.Id));
        Assert.Equal("Lights", Assert.Single(dto.Items).Label);
        Assert.Equal($"https://signed.test/{rows[0].FileUrl}?expires=3600&type=image/jpeg&disposition=inline; filename*=UTF-8''tyre.jpg",
            dto.Attachments[0].Url);
        db.ChangeTracker.Clear();
        var listed = await ListedAsync(run);
        Assert.Equal(dto.Attachments, listed.Attachments);
        Assert.Equal(dto with { Items = listed.Items, Attachments = listed.Attachments }, listed);
        Assert.DoesNotContain("users/", JsonSerializer.Serialize(listed with { Attachments = listed.Attachments.Select(a => a with { Url = null }).ToList() }));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task APdf_OrAnythingButAnImage_IsUnsupportedOnARun_AndNothingIsStored(bool pdf)
    {
        var run = await RunAsync();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            checklists.AddRunAttachmentAsync(userId, run.Id, pdf ? Pdf : "GIF89a"u8.ToArray(), "x.jpg"));

        Assert.Equal("file.unsupportedType", ex.Code);
        Assert.Empty(storage.Objects);
        Assert.Empty(db.Attachments);
    }

    [Fact]
    public async Task EmptyOrOver10MB_IsRejected_AndTheEleventhPhoto_IsTooMany()
    {
        var run = await RunAsync();
        var empty = await Assert.ThrowsAsync<ValidationFailedException>(() => checklists.AddRunAttachmentAsync(userId, run.Id, null, null));
        var large = await Assert.ThrowsAsync<PayloadTooLargeException>(() =>
            checklists.AddRunAttachmentAsync(userId, run.Id, new byte[AttachmentFiles.MaxBytes + 1], "big.jpg"));
        for (var i = 0; i < Attachment.MaxPerParent; i++)
        {
            await checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, $"{i}.png");
        }

        var eleventh = await Assert.ThrowsAsync<ValidationFailedException>(() => checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "11.png"));

        Assert.Equal(("file.required", "file.tooLarge", "attachment.tooMany"), (empty.Code, large.Code, eleventh.Code));
        Assert.Equal(10, eleventh.Extensions["maxCount"]);
        Assert.Equal(10, storage.Objects.Count);
    }

    [Fact]
    public async Task AnotherUsersRunOrPhoto_IsNotFound_AndUntouched()
    {
        var stranger = Guid.NewGuid();
        var theirs = await RunAsync(stranger);
        var theirPhoto = (await checklists.AddRunAttachmentAsync(stranger, theirs.Id, Png1x1, "theirs.png")).Attachments.Single();
        var mine = await RunAsync();
        var myPhoto = (await checklists.AddRunAttachmentAsync(userId, mine.Id, Png1x1, "mine.png")).Attachments.Single();

        var upload = await Assert.ThrowsAsync<NotFoundException>(() => checklists.AddRunAttachmentAsync(userId, theirs.Id, Png1x1, "x.png"));
        var deletes = new[]
        {
            await Assert.ThrowsAsync<NotFoundException>(() => checklists.DeleteRunAttachmentAsync(userId, theirs.Id, theirPhoto.Id)),
            await Assert.ThrowsAsync<NotFoundException>(() => checklists.DeleteRunAttachmentAsync(userId, mine.Id, theirPhoto.Id)),
            await Assert.ThrowsAsync<NotFoundException>(() => checklists.DeleteRunAttachmentAsync(userId, mine.Id, Guid.NewGuid())),
            await Assert.ThrowsAsync<NotFoundException>(() => checklists.DeleteRunAttachmentAsync(stranger, mine.Id, myPhoto.Id))
        };

        Assert.Equal("checklistRun.notFound", upload.Code);
        Assert.All(deletes, e => Assert.Equal("attachment.notFound", e.Code));
        Assert.Equal(2, db.Attachments.Count());
        Assert.Equal(2, storage.Objects.Count);
        await Assert.ThrowsAsync<NotFoundException>(() => checklists.ListRunsAsync(userId, theirs.Checklist));
    }

    [Fact]
    public async Task ServiceRecordAndRunPhotoPaths_DontCross()
    {
        var run = await RunAsync();
        var photo = (await checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "p.png")).Attachments.Single();
        var record = (await tasks.CreateRecordAsync(userId, run.Car, new CreateServiceRecordRequest(null, 1_000, null, null, null, null))).Record;
        var file = (await tasks.AddAttachmentAsync(userId, run.Car, record.Id, Pdf, "r.pdf")).Attachments.Single();

        var viaRecord = await Assert.ThrowsAsync<NotFoundException>(() => tasks.DeleteAttachmentAsync(userId, run.Car, record.Id, photo.Id));
        var viaRun = await Assert.ThrowsAsync<NotFoundException>(() => checklists.DeleteRunAttachmentAsync(userId, run.Id, file.Id));

        Assert.Equal(("attachment.notFound", "attachment.notFound"), (viaRecord.Code, viaRun.Code));
        Assert.Equal(2, db.Attachments.Count());
        Assert.Equal("r.pdf", Assert.Single(Assert.Single(await tasks.ListRecordsAsync(userId, run.Car)).Attachments).FileName);
    }

    // --- Criterion 6: archived car, turned-off checklist ---

    [Fact]
    public async Task ArchivedCar_RejectsUploads_AllowsDelete_AndATurnedOffChecklistsRunStillTakesPhotos()
    {
        var run = await RunAsync();
        await checklists.UpdateAsync(userId, run.Checklist, new UpdateVehicleChecklistRequest(null, null, false));
        var dto = await checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "off.png");
        await vehicles.ArchiveAsync(userId, run.Car, archived: true);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "b.png"));
        await checklists.DeleteRunAttachmentAsync(userId, run.Id, dto.Attachments[0].Id);

        Assert.Equal("attachment.vehicleArchived", ex.Code);
        Assert.Empty(storage.Objects);
        Assert.Empty(db.Attachments);
    }

    // --- Criterion 3: one quota over both parents ---

    [Fact]
    public async Task Quota_CountsServiceFilesAndRunPhotosTogether_OnBothEndpoints_AndFreeingEitherSideLetsTheOtherUpload()
    {
        var options = Options.Create(new StorageOptions { UserQuotaBytes = 2 * Png1x1.Length }); // the PDF is smaller than the PNG
        var limitedRuns = new VehicleChecklistService(db, vehicles, options);
        var limitedTasks = new MaintenanceTaskService(db, vehicles, options);
        var run = await RunAsync();
        var record = (await tasks.CreateRecordAsync(userId, run.Car, new CreateServiceRecordRequest(null, 1_000, null, null, null, null))).Record.Id;
        var stranger = Guid.NewGuid();
        var theirs = await RunAsync(stranger);

        var file = (await limitedTasks.AddAttachmentAsync(userId, run.Car, record, Pdf, "r.pdf")).Attachments.Single();
        await limitedRuns.AddRunAttachmentAsync(userId, run.Id, Png1x1, "p.png"); // within the quota, across both parents

        var onRun = await Assert.ThrowsAsync<ValidationFailedException>(() => limitedRuns.AddRunAttachmentAsync(userId, run.Id, Png1x1, "q.png"));
        var onRecord = await Assert.ThrowsAsync<ValidationFailedException>(() => limitedTasks.AddAttachmentAsync(userId, run.Car, record, Png1x1, "q.png"));
        await limitedRuns.AddRunAttachmentAsync(stranger, theirs.Id, Png1x1, "theirs.png"); // per user

        Assert.Equal(("file.quotaExceeded", "file.quotaExceeded"), (onRun.Code, onRecord.Code));
        Assert.Equal(2L * Png1x1.Length, onRun.Extensions["maxBytes"]);

        // Freeing the service side lets a run photo in; deleting the run frees its photos for a service file.
        await limitedTasks.DeleteAttachmentAsync(userId, run.Car, record, file.Id);
        await limitedRuns.AddRunAttachmentAsync(userId, run.Id, Png1x1, "q.png");
        await Assert.ThrowsAsync<ValidationFailedException>(() => limitedTasks.AddAttachmentAsync(userId, run.Car, record, Pdf, "r.pdf"));
        await limitedRuns.DeleteRunAsync(userId, run.Id);
        await limitedTasks.AddAttachmentAsync(userId, run.Car, record, Pdf, "r.pdf");
    }

    // --- Criterion 4: the paths that delete runs ---

    [Fact]
    public async Task DeleteRun_DeletesItsPhotoRowsThenObjects_OtherRunsKeepTheirs_AndAFailedObjectDeleteIsNotAnError()
    {
        var run = await RunAsync();
        var kept = await RunAsync();
        await checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "a.png");
        await checklists.AddRunAttachmentAsync(userId, run.Id, JpegWithGps(), "b.jpg");
        await checklists.AddRunAttachmentAsync(userId, kept.Id, Png1x1, "kept.png");

        await checklists.DeleteRunAsync(userId, run.Id);

        Assert.Equal("kept.png", Assert.Single(db.Attachments).FileName);
        Assert.StartsWith(Prefix(kept), Assert.Single(storage.Objects).Key);
        var upload = await Assert.ThrowsAsync<NotFoundException>(() => checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "c.png"));
        Assert.Equal("checklistRun.notFound", upload.Code);

        storage.FailDeletes = true;
        await checklists.DeleteRunAsync(userId, kept.Id);
        Assert.Empty(db.Attachments);
        Assert.Empty(db.ChecklistRuns);
        Assert.Single(storage.Objects); // orphaned, logged; the delete itself succeeded
    }

    [Fact]
    public async Task RemovingAChecklistOrDeletingATemplate_WithRuns_IsRefused_SoTheirPhotosStay()
    {
        // Neither path can delete a run today (vehicleChecklist.hasRuns, checklistTemplate.inUse), so neither can orphan a photo.
        var run = await RunAsync();
        await checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "a.png");

        var remove = await Assert.ThrowsAsync<ConflictException>(() => checklists.DeleteAsync(userId, run.Checklist));
        var template = await Assert.ThrowsAsync<ConflictException>(() => templates.DeleteAsync(userId, run.Template));

        Assert.Equal(("vehicleChecklist.hasRuns", "checklistTemplate.inUse"), (remove.Code, template.Code));
        Assert.Single(db.Attachments);
        Assert.Single(storage.Objects);

        // Once the run (and its photos) is deleted, both go through.
        await checklists.DeleteRunAsync(userId, run.Id);
        await checklists.DeleteAsync(userId, run.Checklist);
        await templates.DeleteAsync(userId, run.Template);
        Assert.Empty(db.Attachments);
        Assert.Empty(storage.Objects);
    }

    // --- Criterion 6: keys and storage ---

    [Fact]
    public async Task AStoredKeyOutsideTheRunsPrefix_IsNeverSignedOrDeleted()
    {
        var run = await RunAsync();
        var other = await RunAsync();
        var foreign = new[]
        {
            $"users/{Guid.NewGuid()}/vehicles/{run.Car}/checklist-runs/{run.Id}/{Guid.NewGuid():N}.jpg",
            $"{Prefix(other)}{Guid.NewGuid():N}.jpg",
            $"users/{userId}/vehicles/{run.Car}/service-records/{run.Id}/{Guid.NewGuid():N}.jpg",
            $"users/{userId}/vehicles/{run.Car}/photo/{Guid.NewGuid():N}.jpg",
            $"{Prefix(run)}../../../x.jpg",
            $"{Prefix(run)}{Guid.NewGuid():N}.html",
            $"{Prefix(run)}{Guid.NewGuid():N}.jpg\n"
        };
        foreach (var key in foreign)
        {
            storage.Objects[key] = ([1], "image/jpeg");
            db.Attachments.Add(new Attachment { ChecklistRunId = run.Id, FileUrl = key, FileName = "x.jpg", ContentType = "image/jpeg", SizeBytes = 1 });
        }
        await db.SaveChangesAsync();

        var listed = await ListedAsync(run);
        Assert.Equal(foreign.Length, listed.Attachments.Count);
        Assert.All(listed.Attachments, a => Assert.Null(a.Url));

        await checklists.DeleteRunAttachmentAsync(userId, run.Id, listed.Attachments[0].Id);
        await checklists.DeleteRunAsync(userId, run.Id);
        Assert.Empty(db.Attachments);
        Assert.All(foreign, key => Assert.True(storage.Objects.ContainsKey(key), key));
    }

    [Fact]
    public async Task WithoutStorage_BothCallsAre503_UrlsAreNull_AndDeletingTheRunStillWorks()
    {
        var run = await RunAsync();
        var dto = await checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "a.png");
        var noStorage = new VehicleChecklistService(db, new VehicleService(db));

        var upload = await Assert.ThrowsAsync<ServiceUnavailableException>(() => noStorage.AddRunAttachmentAsync(userId, run.Id, Png1x1, "b.png"));
        var delete = await Assert.ThrowsAsync<ServiceUnavailableException>(() => noStorage.DeleteRunAttachmentAsync(userId, run.Id, dto.Attachments[0].Id));
        var listed = Assert.Single((await ListedAsync(run, noStorage)).Attachments);

        Assert.Equal(("file.storageUnavailable", "file.storageUnavailable"), (upload.Code, delete.Code));
        Assert.Equal(("a.png", (string?)null), (listed.FileName, listed.Url));
        await noStorage.DeleteRunAsync(userId, run.Id);
        Assert.Empty(db.Attachments);
    }

    // ---- HTTP: the real controllers on Kestrel.

    private static string PhotosPath(Run run) => $"/api/checklist-runs/{run.Id}/attachments";

    [Fact]
    public async Task Http_UploadListAndDelete_APdfIs400_Over10MBIs413_AnotherUsersRunIs404()
    {
        var run = await RunAsync();
        var theirs = await RunAsync(Guid.NewGuid());
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (okStatus, ok) = await ReadAsync(await client.PostAsync(PhotosPath(run), Form(PngWithText(100_000), "צמיג.png", "image/png")));
        var (pdfStatus, pdf) = await ReadAsync(await client.PostAsync(PhotosPath(run), Form(Pdf, "x.pdf", "application/pdf")));
        var big = new HttpRequestMessage(HttpMethod.Post, PhotosPath(run)) { Content = Form(new byte[12_000_000], "big.jpg"), Headers = { ExpectContinue = true } };
        var (bigStatus, bigBody) = await ReadAsync(await client.SendAsync(big));
        var (theirStatus, their) = await ReadAsync(await client.PostAsync(PhotosPath(theirs), Form(Png1x1, "x.png")));
        var (_, runs) = await ReadAsync(await client.GetAsync($"/api/vehicle-checklists/{run.Checklist}/runs"));

        Assert.Equal(HttpStatusCode.OK, okStatus);
        Assert.Equal(run.Id.ToString(), ok.GetProperty("id").GetString());
        var photo = Assert.Single(ok.GetProperty("attachments").EnumerateArray());
        Assert.Equal(["id", "fileName", "contentType", "sizeBytes", "url"], photo.EnumerateObject().Select(p => p.Name));
        Assert.Equal(("צמיג.png", "image/png"), (photo.GetProperty("fileName").GetString(), photo.GetProperty("contentType").GetString()));
        Assert.Equal(photo.GetRawText(), runs[0].GetProperty("attachments")[0].GetRawText());
        Assert.Equal((HttpStatusCode.BadRequest, "file.unsupportedType"), (pdfStatus, pdf.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.RequestEntityTooLarge, "file.tooLarge"), (bigStatus, bigBody.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.NotFound, "checklistRun.notFound"), (theirStatus, their.GetProperty("code").GetString()));

        var path = $"{PhotosPath(run)}/{photo.GetProperty("id").GetString()}";
        var delete = await client.DeleteAsync(path);
        var (again, againBody) = await ReadAsync(await client.DeleteAsync(path));
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Equal((HttpStatusCode.NotFound, "attachment.notFound"), (again, againBody.GetProperty("code").GetString()));
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task Http_RunPhotosShareTheUploadBudgetWithServiceFiles()
    {
        var run = await RunAsync();
        var record = (await tasks.CreateRecordAsync(userId, run.Car, new CreateServiceRecordRequest(null, 1_000, null, null, null, null))).Record.Id;
        var (app, client) = await StartAsync(uploadLimit: 2);
        await using var _ = app;

        var first = await client.PostAsync($"/api/vehicles/{run.Car}/service-records/{record}/attachments", Form(Pdf, "a.pdf"));
        var second = await client.PostAsync(PhotosPath(run), Form(Png1x1, "a.png"));
        var (status, body) = await ReadAsync(await client.PostAsync(PhotosPath(run), Form(Png1x1, "b.png")));
        var (_, runs) = await ReadAsync(await client.GetAsync($"/api/vehicle-checklists/{run.Checklist}/runs"));

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (first.StatusCode, second.StatusCode));
        Assert.Equal((HttpStatusCode.TooManyRequests, "http.429"), (status, body.GetProperty("code").GetString()));
        Assert.Equal(1, runs[0].GetProperty("attachments").GetArrayLength());
    }

    [Fact]
    public async Task Http_WithoutStorage_BothEndpointsAre503_AndTheRunsHaveNullUrls()
    {
        var run = await RunAsync();
        var dto = await checklists.AddRunAttachmentAsync(userId, run.Id, Png1x1, "a.png");
        var (app, client) = await StartAsync(withStorage: false);
        await using var _ = app;

        var (upload, uploadBody) = await ReadAsync(await client.PostAsync(PhotosPath(run), Form(Png1x1, "b.png")));
        var (delete, deleteBody) = await ReadAsync(await client.DeleteAsync($"{PhotosPath(run)}/{dto.Attachments[0].Id}"));
        var (_, runs) = await ReadAsync(await client.GetAsync($"/api/vehicle-checklists/{run.Checklist}/runs"));

        Assert.Equal((HttpStatusCode.ServiceUnavailable, "file.storageUnavailable"), (upload, uploadBody.GetProperty("code").GetString()));
        Assert.Equal((HttpStatusCode.ServiceUnavailable, "file.storageUnavailable"), (delete, deleteBody.GetProperty("code").GetString()));
        Assert.Equal(JsonValueKind.Null, runs[0].GetProperty("attachments")[0].GetProperty("url").ValueKind);
    }
}
