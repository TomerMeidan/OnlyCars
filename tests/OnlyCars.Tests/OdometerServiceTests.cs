using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

public class OdometerServiceTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly OdometerService odometer;
    private readonly Guid userId = Guid.NewGuid();

    public OdometerServiceTests()
    {
        vehicles = new VehicleService(db);
        odometer = new OdometerService(db, vehicles);
    }

    private async Task<Guid> CreateCarAsync(decimal? initialKm = null, Guid? owner = null)
    {
        var car = await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, initialKm));
        return car.Id;
    }

    private Task<OdometerReadingDto> AddAsync(Guid carId, decimal km, int daysAgo, bool confirm = false) =>
        odometer.AddAsync(userId, carId, new AddOdometerReadingRequest(km, Today.AddDays(-daysAgo), confirm));

    private Task<OdometerReadingDto> EditAsync(Guid carId, Guid readingId, decimal km, int daysAgo, bool confirm = false) =>
        odometer.UpdateAsync(userId, carId, readingId, new UpdateOdometerReadingRequest(km, Today.AddDays(-daysAgo), confirm));

    private Task<VehicleDto> CarAsync(Guid carId) => vehicles.GetAsync(userId, carId);

    // --- Add ---

    [Fact]
    public async Task Add_HigherReading_UpdatesVehicleCurrentOdometer()
    {
        var car = await CreateCarAsync(10000);

        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(10500, null));

        Assert.Equal(10500, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Add_LowerReadingWithoutConfirmation_ThrowsLowerThanPrevious()
    {
        var car = await CreateCarAsync(10000);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            odometer.AddAsync(userId, car, new AddOdometerReadingRequest(9000, null)));

        Assert.Equal("odometer.lowerThanPrevious", ex.Code);
        Assert.Equal(10000m, ex.Extensions["previousKm"]);
        Assert.Single(db.OdometerReadings);
    }

    [Fact]
    public async Task Add_LowerReadingWithConfirmation_Succeeds_ButDoesNotRegressCurrentOdometer()
    {
        // New rule: the current odometer is the latest-dated reading, so a backdated reading never changes it.
        var car = await CreateCarAsync(10000);

        var reading = await odometer.AddAsync(userId, car,
            new AddOdometerReadingRequest(9000, Today.AddDays(-30), ConfirmCorrection: true));

        Assert.Equal(9000, reading.ValueKm);
        Assert.Equal(10000, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Add_ConfirmedCorrectionForToday_LowersCurrentOdometer()
    {
        var car = await CreateCarAsync(10000);

        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(9000, null, ConfirmCorrection: true));

        Assert.Equal(9000, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Add_BackdatedReadingHigherThanALaterOne_ThrowsHigherThanNext()
    {
        var car = await CreateCarAsync(10000);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, 12000, daysAgo: 5));

        Assert.Equal("odometer.higherThanNext", ex.Code);
        Assert.Equal(10000m, ex.Extensions["nextKm"]);
        Assert.Equal(10000, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Theory]
    [InlineData("12345.00", "12345")]
    [InlineData("12345.50", "12345.5")]
    public async Task OrderErrors_ReturnKmWithoutTrailingZeros(string stored, string expected)
    {
        // The column is decimal(12,2): SQL Server hands back 12345.00 for 12345 (L201).
        var car = await CreateCarAsync(decimal.Parse(stored, System.Globalization.CultureInfo.InvariantCulture));

        var lower = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, 1, daysAgo: 0));
        var higher = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, 99_999, daysAgo: 5));

        Assert.Equal(expected, ((decimal)lower.Extensions["previousKm"]!).ToString(System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(expected, ((decimal)higher.Extensions["nextKm"]!).ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Add_FutureDate_ThrowsFutureDate_EvenWithConfirmation_ButTomorrowIsAllowed()
    {
        var car = await CreateCarAsync();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            odometer.AddAsync(userId, car, new AddOdometerReadingRequest(100, Today.AddDays(2), ConfirmCorrection: true)));
        Assert.Equal("odometer.futureDate", ex.Code);
        Assert.Empty(db.OdometerReadings);

        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(100, Today.AddDays(1)));
        Assert.Single(db.OdometerReadings);
    }

    [Fact]
    public async Task Add_And_Edit_NegativeValue_ThrowInvalidValue()
    {
        var car = await CreateCarAsync(10000);
        var reading = db.OdometerReadings.Single();

        var add = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, -1, 0, confirm: true));
        var edit = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, reading.Id, -1, 0, confirm: true));

        Assert.Equal("odometer.invalidValue", add.Code);
        Assert.Equal("odometer.invalidValue", edit.Code);
        Assert.Equal(10000, reading.ValueKm);
    }

    [Fact]
    public async Task Add_And_Edit_ValueAboveTenMillionKm_ThrowInvalidValue_ButTheCapItselfIsAllowed()
    {
        var car = await CreateCarAsync(10000);
        var reading = db.OdometerReadings.Single();

        var add = await Assert.ThrowsAsync<ValidationFailedException>(() => AddAsync(car, 1e15m, 0, confirm: true));
        var edit = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, reading.Id, 10_000_000.01m, 0, confirm: true));

        Assert.Equal("odometer.invalidValue", add.Code);
        Assert.Equal("odometer.invalidValue", edit.Code);
        Assert.Single(db.OdometerReadings);
        Assert.Equal(10000, reading.ValueKm);

        await EditAsync(car, reading.Id, 10_000_000, 0);
        Assert.Equal(10_000_000, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Add_ForVehicleOwnedByAnotherUser_ThrowsNotFound()
    {
        var car = await CreateCarAsync(10000, owner: Guid.NewGuid());

        await Assert.ThrowsAsync<NotFoundException>(() =>
            odometer.AddAsync(userId, car, new AddOdometerReadingRequest(10500, null)));
    }

    [Fact]
    public async Task AvgKmPerDay_ComputedFromFirstAndLastReading()
    {
        var car = await CreateCarAsync();
        await AddAsync(car, 10000, daysAgo: 10);
        await AddAsync(car, 10500, daysAgo: 0);

        Assert.Equal(50, (await CarAsync(car)).AvgKmPerDay);
    }

    // --- Edit ---

    [Fact]
    public async Task Edit_OlderReading_KeepsCurrent_EditLatest_ChangesCurrentAndAverage()
    {
        var car = await CreateCarAsync();
        await AddAsync(car, 10000, daysAgo: 10);
        var middle = await AddAsync(car, 10200, daysAgo: 5);
        var latest = await AddAsync(car, 10500, daysAgo: 0);

        var edited = await EditAsync(car, middle.Id, 10300, daysAgo: 4);
        Assert.Equal(10300, edited.ValueKm);
        Assert.Equal(Today.AddDays(-4), edited.ReadingDate);
        Assert.Equal(10500, (await CarAsync(car)).CurrentOdometerKm);
        Assert.Equal(50, (await CarAsync(car)).AvgKmPerDay);

        await EditAsync(car, latest.Id, 11000, daysAgo: 0);
        Assert.Equal(11000, (await CarAsync(car)).CurrentOdometerKm);
        Assert.Equal(100, (await CarAsync(car)).AvgKmPerDay);
    }

    [Fact]
    public async Task Edit_LatestToSameDayAsFirst_MakesAverageNull()
    {
        var car = await CreateCarAsync();
        await AddAsync(car, 10000, daysAgo: 10);
        var latest = await AddAsync(car, 10500, daysAgo: 0);
        Assert.NotNull((await CarAsync(car)).AvgKmPerDay);

        await EditAsync(car, latest.Id, 10500, daysAgo: 10);

        Assert.Null((await CarAsync(car)).AvgKmPerDay);
        Assert.Equal(10500, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Edit_LowerThanPrevious_ThrowsAndSavesNothing_ThenConfirmationSaves()
    {
        var car = await CreateCarAsync();
        await AddAsync(car, 10000, daysAgo: 10);
        var latest = await AddAsync(car, 10500, daysAgo: 0);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, latest.Id, 9000, daysAgo: 0));
        Assert.Equal("odometer.lowerThanPrevious", ex.Code);
        Assert.Equal(10000m, ex.Extensions["previousKm"]);
        Assert.Equal(10500, db.OdometerReadings.Single(r => r.Id == latest.Id).ValueKm);
        Assert.Equal(10500, (await CarAsync(car)).CurrentOdometerKm);

        await EditAsync(car, latest.Id, 9000, daysAgo: 0, confirm: true);
        Assert.Equal(9000, (await CarAsync(car)).CurrentOdometerKm);
        Assert.Null((await CarAsync(car)).AvgKmPerDay);
    }

    [Fact]
    public async Task Edit_HigherThanNext_ThrowsAndSavesNothing_ThenConfirmationSaves()
    {
        var car = await CreateCarAsync();
        var first = await AddAsync(car, 10000, daysAgo: 10);
        await AddAsync(car, 10500, daysAgo: 0);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, first.Id, 11000, daysAgo: 10));
        Assert.Equal("odometer.higherThanNext", ex.Code);
        Assert.Equal(10500m, ex.Extensions["nextKm"]);
        Assert.Equal(10000, db.OdometerReadings.Single(r => r.Id == first.Id).ValueKm);

        await EditAsync(car, first.Id, 11000, daysAgo: 10, confirm: true);
        Assert.Equal(11000, db.OdometerReadings.Single(r => r.Id == first.Id).ValueKm);
        Assert.Equal(10500, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Edit_MovingDatePastANeighbour_IsCheckedAgainstTheNewNeighbours()
    {
        var car = await CreateCarAsync();
        var a = await AddAsync(car, 10000, daysAgo: 10);
        await AddAsync(car, 10200, daysAgo: 5);
        var c = await AddAsync(car, 10400, daysAgo: 1);

        // Valid against A's old neighbours (none before, 10200 after), invalid against its new ones (10200 before).
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, a.Id, 10000, daysAgo: 3));
        Assert.Equal("odometer.lowerThanPrevious", ex.Code);
        Assert.Equal(10200m, ex.Extensions["previousKm"]);

        // Invalid against C's old neighbours (10200 before), valid between its new ones (10000 and 10200).
        await EditAsync(car, c.Id, 10100, daysAgo: 7);
        Assert.Equal(10200, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Edit_ValueEqualToNeighbours_IsAcceptedWithoutConfirmation()
    {
        var car = await CreateCarAsync();
        await AddAsync(car, 10000, daysAgo: 10);
        var middle = await AddAsync(car, 10200, daysAgo: 5);
        await AddAsync(car, 10500, daysAgo: 0);

        await EditAsync(car, middle.Id, 10000, daysAgo: 5);
        await EditAsync(car, middle.Id, 10500, daysAgo: 5);

        Assert.Equal(10500, db.OdometerReadings.Single(r => r.Id == middle.Id).ValueKm);
    }

    [Fact]
    public async Task Edit_FutureDate_ThrowsFutureDate_EvenWithConfirmation()
    {
        var car = await CreateCarAsync(10000);
        var reading = db.OdometerReadings.Single();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, reading.Id, 10000, daysAgo: -2, confirm: true));

        Assert.Equal("odometer.futureDate", ex.Code);
        Assert.Equal(Today, reading.ReadingDate);
    }

    [Fact]
    public async Task Edit_WithoutReadingDate_KeepsTheReadingsDate()
    {
        var car = await CreateCarAsync();
        var reading = await AddAsync(car, 10000, daysAgo: 7);

        var edited = await odometer.UpdateAsync(userId, car, reading.Id, new UpdateOdometerReadingRequest(10100, null));

        Assert.Equal(10100, edited.ValueKm);
        Assert.Equal(Today.AddDays(-7), edited.ReadingDate);
        Assert.Equal(Today.AddDays(-7), db.OdometerReadings.Single().ReadingDate);
    }

    [Fact]
    public async Task SameDayReadings_AreOrderedByCreatedAt()
    {
        var car = await CreateCarAsync();
        var created = DateTimeOffset.UtcNow.AddDays(-1);
        // The later-created reading is inserted first, so storage order disagrees with CreatedAt order.
        var later = new OdometerReading { VehicleId = car, ValueKm = 10500, ReadingDate = Today.AddDays(-1), CreatedAt = created.AddMinutes(1) };
        var earlier = new OdometerReading { VehicleId = car, ValueKm = 10000, ReadingDate = Today.AddDays(-1), CreatedAt = created };
        db.OdometerReadings.AddRange(later, earlier);
        await db.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, earlier.Id, 11000, daysAgo: 1));
        Assert.Equal("odometer.higherThanNext", ex.Code);
        Assert.Equal(10500m, ex.Extensions["nextKm"]);

        // Confirmed, the edit recomputes the car: the later-created reading is still the current one.
        await EditAsync(car, earlier.Id, 11000, daysAgo: 1, confirm: true);
        Assert.Equal(10500, (await CarAsync(car)).CurrentOdometerKm);
    }

    // --- Delete ---

    [Fact]
    public async Task Delete_LatestReading_MakesThePreviousOneCurrent_AndRecomputesAverage()
    {
        var car = await CreateCarAsync();
        await AddAsync(car, 10000, daysAgo: 10);
        await AddAsync(car, 10200, daysAgo: 5);
        var latest = await AddAsync(car, 10500, daysAgo: 0);
        Assert.Equal(50, (await CarAsync(car)).AvgKmPerDay);

        await odometer.DeleteAsync(userId, car, latest.Id);

        Assert.Equal(2, db.OdometerReadings.Count());
        Assert.Equal(10200, (await CarAsync(car)).CurrentOdometerKm);
        Assert.Equal(40, (await CarAsync(car)).AvgKmPerDay);
    }

    [Fact]
    public async Task Delete_OnlyReading_ThrowsConflict_AndChangesNothing()
    {
        var car = await CreateCarAsync(10000);
        var reading = db.OdometerReadings.Single();

        var ex = await Assert.ThrowsAsync<ConflictException>(() => odometer.DeleteAsync(userId, car, reading.Id));

        Assert.Equal("odometer.onlyReading", ex.Code);
        Assert.Single(db.OdometerReadings);
        Assert.Equal(10000, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Delete_NeverNeedsConfirmation_EvenIfTheRemainingReadingsAreOutOfOrder()
    {
        var car = await CreateCarAsync();
        await AddAsync(car, 10000, daysAgo: 10);
        await AddAsync(car, 9000, daysAgo: 5, confirm: true);
        var latest = await AddAsync(car, 10500, daysAgo: 0);

        await odometer.DeleteAsync(userId, car, latest.Id);

        Assert.Equal(9000, (await CarAsync(car)).CurrentOdometerKm);
        Assert.Null((await CarAsync(car)).AvgKmPerDay);
    }

    // --- Rules for every write ---

    [Fact]
    public async Task EditOrDelete_NonManualReading_ThrowsNotManual()
    {
        var car = await CreateCarAsync(10000);
        var service = new OdometerReading { VehicleId = car, ValueKm = 9000, ReadingDate = Today.AddDays(-5), Source = OdometerSource.Service };
        db.OdometerReadings.Add(service);
        await db.SaveChangesAsync();

        var edit = await Assert.ThrowsAsync<ConflictException>(() => EditAsync(car, service.Id, 9100, daysAgo: 5));
        var delete = await Assert.ThrowsAsync<ConflictException>(() => odometer.DeleteAsync(userId, car, service.Id));

        Assert.Equal("odometer.notManual", edit.Code);
        Assert.Equal("odometer.notManual", delete.Code);
        Assert.Equal(9000, service.ValueKm);
        Assert.Equal(2, db.OdometerReadings.Count());
    }

    [Fact]
    public async Task EditOrDelete_ReadingOfAnotherCarOfTheSameUser_ThrowsNotFound()
    {
        var mine = await CreateCarAsync(10000);
        var other = await CreateCarAsync(20000);
        var otherReading = db.OdometerReadings.Single(r => r.VehicleId == other);

        var edit = await Assert.ThrowsAsync<NotFoundException>(() => EditAsync(mine, otherReading.Id, 1, 0, confirm: true));
        var delete = await Assert.ThrowsAsync<NotFoundException>(() => odometer.DeleteAsync(userId, mine, otherReading.Id));

        Assert.Equal("odometerReading.notFound", edit.Code);
        Assert.Equal("odometerReading.notFound", delete.Code);
        Assert.Equal(20000, otherReading.ValueKm);
        Assert.Equal(10000, (await CarAsync(mine)).CurrentOdometerKm);
    }

    [Fact]
    public async Task EditOrDelete_ReadingOfAnotherUsersCar_ThrowsNotFound()
    {
        var mine = await CreateCarAsync(10000);
        var theirs = await CreateCarAsync(20000, owner: Guid.NewGuid());
        var theirReading = db.OdometerReadings.Single(r => r.VehicleId == theirs);

        // Through my own car id: the reading isn't on my car.
        var viaMine = await Assert.ThrowsAsync<NotFoundException>(() => EditAsync(mine, theirReading.Id, 1, 0, confirm: true));
        // Through their car id: the car itself is not found, the same answer as a car that doesn't exist.
        var viaTheirs = await Assert.ThrowsAsync<NotFoundException>(() => odometer.DeleteAsync(userId, theirs, theirReading.Id));

        Assert.Equal("odometerReading.notFound", viaMine.Code);
        Assert.Equal("vehicle.notFound", viaTheirs.Code);
        Assert.Equal(2, db.OdometerReadings.Count());
        Assert.Equal(20000, theirReading.ValueKm);
    }
}
