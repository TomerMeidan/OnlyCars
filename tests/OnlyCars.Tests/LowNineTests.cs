using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>LOW-9 L183: only a lock conflict on an attachment save becomes 409 (DbUpdateConcurrencyException); any other save error stays 500.</summary>
public class LowNineTests : FileTestBase
{
    private readonly FailSave fail = new();

    /// <summary>A PostgresException stand-in: the attachment code reads the SqlState every DbException has.</summary>
    private sealed class FakeDbException(string sqlState) : DbException
    {
        public override string SqlState => sqlState;
    }

    /// <summary>Throws <see cref="Next"/> from the next save, as Postgres's error arrives through EF.</summary>
    private sealed class FailSave : SaveChangesInterceptor
    {
        public Exception? Next { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Next is { } e)
            {
                Next = null;
                throw e;
            }

            return ValueTask.FromResult(result);
        }
    }

    // As the non-retrying execution strategy wraps a transient database error: InvalidOperationException > DbUpdateException > PostgresException.
    private static Exception Wrapped(string sqlState) =>
        new InvalidOperationException("transient", new DbUpdateException("save failed", new FakeDbException(sqlState)));

    private async Task<(VehicleChecklistService Service, Guid RunId)> RunAsync()
    {
        var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(dbName).AddInterceptors(fail).Options);
        var service = new VehicleChecklistService(context, new VehicleService(context, storage));
        var car = await new VehicleService(context, storage).CreateAsync(userId,
            new CreateVehicleRequest("Car", null, null, null, null, null, null, null, null, null, 10_000));
        var template = await new ChecklistTemplateService(context).CreateAsync(userId,
            new ChecklistTemplateRequest("Check", [new(null, "Lights", "Check", null, null, null)]));
        var checklist = await service.AttachAsync(userId, car.Id, new AttachChecklistRequest(template.Id, null, null, null));
        var run = await service.CreateRunAsync(userId, checklist.Id,
            new CreateChecklistRunRequest(null, null, null, [new ChecklistRunItemRequest(template.Items[0].Id, true, null, null)]));
        return (service, run.Run.Id);
    }

    [Theory]
    [InlineData("40P01")] // deadlock victim (the account delete, L173)
    [InlineData("55P03")] // lock not available
    public async Task L183_ALockConflict_IsStill409_AndTheObjectIsDeleted(string sqlState)
    {
        var (service, runId) = await RunAsync();
        fail.Next = Wrapped(sqlState);

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => service.AddRunAttachmentAsync(userId, runId, AttachmentTests.Webp(), "a.webp"));

        Assert.Empty(storage.Objects);
    }

    [Theory]
    [InlineData("57014")] // query cancelled: transient, so it arrives wrapped like a deadlock
    [InlineData("3D000")] // no such database
    public async Task L183_AnyOtherSaveError_IsRethrown_As500_AndTheObjectIsDeleted(string sqlState)
    {
        var (service, runId) = await RunAsync();
        var error = Wrapped(sqlState);
        fail.Next = error;

        Assert.Same(error, await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.AddRunAttachmentAsync(userId, runId, AttachmentTests.Webp(), "a.webp")));

        Assert.Empty(storage.Objects);
    }
}
