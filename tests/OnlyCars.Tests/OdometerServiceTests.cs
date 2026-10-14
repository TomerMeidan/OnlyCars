using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;

namespace OnlyCars.Tests;

public class OdometerServiceTests
{
    private static (OdometerService Odometer, VehicleService Vehicles) CreateServices()
    {
        var db = TestDbContextFactory.Create();
        var vehicles = new VehicleService(db);
        var odometer = new OdometerService(db, vehicles);
        return (odometer, vehicles);
    }

    [Fact]
    public async Task Add_HigherReading_UpdatesVehicleCurrentOdometer()
    {
        var (odometer, vehicles) = CreateServices();
        var userId = Guid.NewGuid();
        var vehicle = await vehicles.CreateAsync(userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 10000));

        await odometer.AddAsync(userId, vehicle.Id, new AddOdometerReadingRequest(10500, null));

        var updated = await vehicles.GetAsync(userId, vehicle.Id);
        Assert.Equal(10500, updated.CurrentOdometerKm);
    }

    [Fact]
    public async Task Add_LowerReadingWithoutConfirmation_ThrowsValidationFailed()
    {
        var (odometer, vehicles) = CreateServices();
        var userId = Guid.NewGuid();
        var vehicle = await vehicles.CreateAsync(userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 10000));

        await Assert.ThrowsAsync<ValidationFailedException>(() =>
            odometer.AddAsync(userId, vehicle.Id, new AddOdometerReadingRequest(9000, null)));
    }

    [Fact]
    public async Task Add_LowerReadingWithConfirmation_Succeeds_ButDoesNotRegressCurrentOdometer()
    {
        var (odometer, vehicles) = CreateServices();
        var userId = Guid.NewGuid();
        var vehicle = await vehicles.CreateAsync(userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 10000));

        var reading = await odometer.AddAsync(userId, vehicle.Id,
            new AddOdometerReadingRequest(9000, new DateOnly(2026, 1, 1), ConfirmCorrection: true));

        Assert.Equal(9000, reading.ValueKm);

        var updated = await vehicles.GetAsync(userId, vehicle.Id);
        Assert.Equal(10000, updated.CurrentOdometerKm);
    }

    [Fact]
    public async Task Add_ConfirmedCorrectionForToday_LowersCurrentOdometer()
    {
        var (odometer, vehicles) = CreateServices();
        var userId = Guid.NewGuid();
        var vehicle = await vehicles.CreateAsync(userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 10000));

        await odometer.AddAsync(userId, vehicle.Id,
            new AddOdometerReadingRequest(9000, null, ConfirmCorrection: true));

        var updated = await vehicles.GetAsync(userId, vehicle.Id);
        Assert.Equal(9000, updated.CurrentOdometerKm);
    }

    [Fact]
    public async Task Add_ForVehicleOwnedByAnotherUser_ThrowsNotFound()
    {
        var (odometer, vehicles) = CreateServices();
        var owner = Guid.NewGuid();
        var intruder = Guid.NewGuid();
        var vehicle = await vehicles.CreateAsync(owner, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 10000));

        await Assert.ThrowsAsync<Application.Common.Exceptions.NotFoundException>(() =>
            odometer.AddAsync(intruder, vehicle.Id, new AddOdometerReadingRequest(10500, null)));
    }

    [Fact]
    public async Task AvgKmPerDay_ComputedFromFirstAndLastReading()
    {
        var (odometer, vehicles) = CreateServices();
        var userId = Guid.NewGuid();
        var vehicle = await vehicles.CreateAsync(userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 10000));

        // Initial reading was logged "today"; backdate by adding a reading 10 days in the future for 10*50=500km more.
        var futureDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(10);
        await odometer.AddAsync(userId, vehicle.Id, new AddOdometerReadingRequest(10500, futureDate));

        var updated = await vehicles.GetAsync(userId, vehicle.Id);
        Assert.Equal(50, updated.AvgKmPerDay);
    }
}
