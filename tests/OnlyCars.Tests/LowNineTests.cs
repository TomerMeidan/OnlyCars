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

    /// <summary>A SqlException stand-in: the attachment code reads its Number, as on Microsoft.Data.SqlClient.SqlException.</summary>
    private sealed class FakeSqlException(int number) : DbException
    {
        public int Number => number;
    }

    /// <summary>Throws <see cref="Next"/> from the next save, as SQL Server's error arrives through EF.</summary>
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

    // As the non-retrying execution strategy wraps a transient SQL error: InvalidOperationException > DbUpdateException > SqlException.
    private static Exception Wrapped(int number) =>
        new InvalidOperationException("transient", new DbUpdateException("save failed", new FakeSqlException(number)));

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
    [InlineData(1205)] // deadlock victim (the account delete, L173)
    [InlineData(1222)] // lock request time-out
    public async Task L183_ALockConflict_IsStill409_AndTheObjectIsDeleted(int number)
    {
        var (service, runId) = await RunAsync();
        fail.Next = Wrapped(number);

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => service.AddRunAttachmentAsync(userId, runId, AttachmentTests.Webp(), "a.webp"));

        Assert.Empty(storage.Objects);
    }

    [Theory]
    [InlineData(-2)] // command timeout: transient, so it arrives wrapped like a deadlock
    [InlineData(4060)] // cannot open database
    public async Task L183_AnyOtherSaveError_IsRethrown_As500_AndTheObjectIsDeleted(int number)
    {
        var (service, runId) = await RunAsync();
        var error = Wrapped(number);
        fail.Next = error;

        Assert.Same(error, await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.AddRunAttachmentAsync(userId, runId, AttachmentTests.Webp(), "a.webp")));

        Assert.Empty(storage.Objects);
    }
}
