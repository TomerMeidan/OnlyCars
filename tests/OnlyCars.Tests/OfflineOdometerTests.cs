using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>
/// OFF-1 idempotent odometer add on Postgres: InMemory doesn't enforce the filtered unique (VehicleId, ClientRequestId) index.
/// </summary>
public class OfflineOdometerTests : IAsyncLifetime
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly string connection = TestDbContextFactory.NewPostgresConnection();
    private readonly AppDbContext db;
    private readonly Guid me = Guid.NewGuid();
    private readonly Guid other = Guid.NewGuid();

    public OfflineOdometerTests() => db = Context();

    private AppDbContext Context(params IInterceptor[] interceptors) =>
        new(TestDbContextFactory.PostgresOptions(connection).AddInterceptors(interceptors).Options);

    public async Task InitializeAsync()
    {
        await db.Database.MigrateAsync();
        db.Users.AddRange(new User { Id = me, Email = $"{me:N}@x.test", PasswordHash = "x" },
            new User { Id = other, Email = $"{other:N}@x.test", PasswordHash = "x" });
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    private static OdometerService Odometer(AppDbContext context) => new(context, new VehicleService(context));

    private async Task<Guid> CarAsync(Guid owner, decimal km = 10000) =>
        (await new VehicleService(db).CreateAsync(owner, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, km, Today.AddDays(-30)))).Id;

    private static AddOdometerReadingRequest Request(decimal km, Guid? id, int daysAgo = 0) => new(km, Today.AddDays(-daysAgo), false, id);

    private Task<int> CountAsync(Guid car) => db.OdometerReadings.CountAsync(r => r.VehicleId == car);

    [Fact]
    public async Task SameId_ReturnsTheSavedReading_AsEditedSince_WithNoNewRow()
    {
        var car = await CarAsync(me);
        var id = Guid.NewGuid();
        var first = await Odometer(db).AddAsync(me, car, Request(10500, id));
        await Odometer(db).UpdateAsync(me, car, first.Id, new UpdateOdometerReadingRequest(10600, null));

        var again = await Odometer(Context()).AddAsync(me, car, Request(10500, id));

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(10600, again.ValueKm);
        Assert.Equal(2, await CountAsync(car));
    }

    [Fact]
    public async Task SameId_IsAnsweredBeforeTheDateOrderCheck()
    {
        var car = await CarAsync(me);
        var id = Guid.NewGuid();
        var first = await Odometer(db).AddAsync(me, car, Request(10500, id, daysAgo: 5));
        await Odometer(db).AddAsync(me, car, Request(11000, null));

        // Would now be lowerThanPrevious (11,000 today) if it were checked again.
        var again = await Odometer(Context()).AddAsync(me, car, Request(10500, id));

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(3, await CountAsync(car));
        var fresh = await Assert.ThrowsAsync<ValidationFailedException>(() => Odometer(Context()).AddAsync(me, car, Request(10500, Guid.NewGuid())));
        Assert.Equal("odometer.lowerThanPrevious", fresh.Code);
    }

    [Fact]
    public async Task SameId_IsAnsweredBeforeTheCap()
    {
        var car = await CarAsync(me);
        var id = Guid.NewGuid();
        var first = await Odometer(db).AddAsync(me, car, Request(10500, id));
        db.OdometerReadings.AddRange(Enumerable.Range(0, OdometerReading.MaxPerVehicle - 2)
            .Select(_ => new OdometerReading { VehicleId = car, ValueKm = 10500, ReadingDate = Today }));
        await db.SaveChangesAsync();

        var again = await Odometer(Context()).AddAsync(me, car, Request(10500, id));

        Assert.Equal(first.Id, again.Id);
        var fresh = await Assert.ThrowsAsync<ValidationFailedException>(() => Odometer(Context()).AddAsync(me, car, Request(10500, Guid.NewGuid())));
        Assert.Equal("odometer.tooMany", fresh.Code);
    }

    [Fact]
    public async Task SameId_OnAnotherCarOrAnotherUsersCar_CreatesANormalReading()
    {
        var mine = await CarAsync(me);
        var mySecond = await CarAsync(me);
        var theirs = await CarAsync(other);
        var id = Guid.NewGuid();

        var a = await Odometer(db).AddAsync(me, mine, Request(10500, id));
        var b = await Odometer(db).AddAsync(me, mySecond, Request(10700, id));
        var c = await Odometer(db).AddAsync(other, theirs, Request(10900, id));

        Assert.Equal(3, new[] { a.Id, b.Id, c.Id }.Distinct().Count());
        Assert.Equal(10900, (await new VehicleService(Context()).GetAsync(other, theirs)).CurrentOdometerKm);
    }

    [Fact]
    public async Task SameId_OnAnotherUsersCar_Is404_AndDoesNotRevealTheirReading()
    {
        var theirs = await CarAsync(other);
        var id = Guid.NewGuid();
        await Odometer(db).AddAsync(other, theirs, Request(10500, id));

        await Assert.ThrowsAsync<NotFoundException>(() => Odometer(Context()).AddAsync(me, theirs, Request(10500, id)));
        Assert.Equal(2, await CountAsync(theirs));
    }

    [Fact]
    public async Task NoId_BehavesAsBefore_TwoPostsAddTwoReadings()
    {
        var car = await CarAsync(me);

        await Odometer(db).AddAsync(me, car, Request(10500, null));
        await Odometer(db).AddAsync(me, car, Request(10500, null));

        Assert.Equal(3, await CountAsync(car));
        Assert.Null(await db.OdometerReadings.Where(r => r.VehicleId == car).Select(r => r.ClientRequestId).FirstOrDefaultAsync(r => r != null));
    }

    /// <summary>Runs the other post in full just before this context saves, so both have passed the "already sent?" check.</summary>
    private sealed class OtherPostFirst(Func<Task> other) : SaveChangesInterceptor
    {
        private bool done;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (!done)
            {
                done = true;
                await other();
            }
            return result;
        }
    }

    [Fact]
    public async Task TwoIdenticalPostsAtOnce_GiveOneRow_AndTheLoserReturnsTheWinnersReading()
    {
        var car = await CarAsync(me);
        var id = Guid.NewGuid();
        OdometerReadingDto? winner = null;
        await using var winnerDb = Context();
        await using var loserDb = Context(new OtherPostFirst(async () => winner = await Odometer(winnerDb).AddAsync(me, car, Request(10500, id))));

        var loser = await Odometer(loserDb).AddAsync(me, car, Request(10500, id));

        Assert.NotNull(winner);
        Assert.Equal(winner.Id, loser.Id);
        Assert.Equal(2, await CountAsync(car));
        Assert.Equal(10500, (await new VehicleService(Context()).GetAsync(me, car)).CurrentOdometerKm);
    }

    // LOW-9 L193: the repeat comes back from the decimal(12,2) column as 12345.00 unless the DTO drops the zeros.
    [Theory]
    [InlineData("12345", "12345")]
    [InlineData("12345.5", "12345.5")]
    [InlineData("12345.50", "12345.5")]
    public async Task L193_ARepeatedCreate_ReturnsValueKm_InTheSameJsonShape_AsTheFirst(string sent, string json)
    {
        var car = await CarAsync(me);
        var id = Guid.NewGuid();
        var km = decimal.Parse(sent, System.Globalization.CultureInfo.InvariantCulture);

        var first = await Odometer(db).AddAsync(me, car, Request(km, id));
        var again = await Odometer(Context()).AddAsync(me, car, Request(km, id));

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(json, System.Text.Json.JsonSerializer.Serialize(first.ValueKm));
        Assert.Equal(json, System.Text.Json.JsonSerializer.Serialize(again.ValueKm));
        Assert.Equal(json, System.Text.Json.JsonSerializer.Serialize((await Odometer(Context()).HistoryAsync(me, car))[0].ValueKm));
    }

    // LOW-9 L194: the all-zero id would make every such reading "the same"; 400 before anything is saved, also on a second try.
    [Fact]
    public async Task L194_TheAllZeroClientRequestId_IsRejected_AndSavesNoRow()
    {
        var car = await CarAsync(me);

        for (var i = 0; i < 2; i++)
        {
            var error = await Assert.ThrowsAsync<ValidationFailedException>(() => Odometer(Context()).AddAsync(me, car, Request(10500, Guid.Empty)));
            Assert.Equal("odometer.invalidClientRequestId", error.Code);
        }

        Assert.Equal(1, await CountAsync(car));
        // Another user's car stays a 404 first, as for every other check.
        var others = await CarAsync(other);
        await Assert.ThrowsAsync<NotFoundException>(() => Odometer(Context()).AddAsync(me, others, Request(10500, Guid.Empty)));
    }
}
