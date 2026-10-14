using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;

namespace OnlyCars.Tests;

public class VehicleServiceTests
{
    private static VehicleService CreateService() => new(TestDbContextFactory.Create());

    [Fact]
    public async Task Create_WithInitialOdometer_SetsCurrentOdometerAndLogsReading()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();

        var vehicle = await service.CreateAsync(userId, new CreateVehicleRequest(
            "My Car", "Toyota", "Corolla", 2021, null, null, null, null, null, null, InitialOdometerKm: 12000));

        Assert.Equal(12000, vehicle.CurrentOdometerKm);
    }

    [Fact]
    public async Task Create_DuplicateVinForSameUser_ThrowsConflict()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();

        await service.CreateAsync(userId, new CreateVehicleRequest(
            "Car 1", null, null, null, "VIN123", null, null, null, null, null, null));

        await Assert.ThrowsAsync<ConflictException>(() =>
            service.CreateAsync(userId, new CreateVehicleRequest(
                "Car 2", null, null, null, "VIN123", null, null, null, null, null, null)));
    }

    [Fact]
    public async Task Create_DuplicateVinForDifferentUsers_Allowed()
    {
        var service = CreateService();

        await service.CreateAsync(Guid.NewGuid(), new CreateVehicleRequest(
            "Car 1", null, null, null, "SHARED-VIN", null, null, null, null, null, null));

        var vehicle = await service.CreateAsync(Guid.NewGuid(), new CreateVehicleRequest(
            "Car 2", null, null, null, "SHARED-VIN", null, null, null, null, null, null));

        Assert.Equal("SHARED-VIN", vehicle.Vin);
    }

    [Fact]
    public async Task Get_VehicleOwnedByAnotherUser_ThrowsNotFound()
    {
        var service = CreateService();
        var owner = Guid.NewGuid();
        var intruder = Guid.NewGuid();

        var vehicle = await service.CreateAsync(owner, new CreateVehicleRequest(
            "Private Car", null, null, null, null, null, null, null, null, null, null));

        await Assert.ThrowsAsync<NotFoundException>(() => service.GetAsync(intruder, vehicle.Id));
    }

    [Fact]
    public async Task Archive_SetsIsArchivedAndArchivedAt()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();

        var vehicle = await service.CreateAsync(userId, new CreateVehicleRequest(
            "Soon Sold", null, null, null, null, null, null, null, null, null, null));

        await service.ArchiveAsync(userId, vehicle.Id, archived: true);

        var all = await service.ListAsync(userId, includeArchived: true);
        var active = await service.ListAsync(userId, includeArchived: false);

        Assert.Single(all);
        Assert.True(all[0].IsArchived);
        Assert.Empty(active);
    }

    [Fact]
    public async Task List_DefaultsToExcludingArchived()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();

        var vehicle = await service.CreateAsync(userId, new CreateVehicleRequest(
            "Will Archive", null, null, null, null, null, null, null, null, null, null));
        await service.ArchiveAsync(userId, vehicle.Id, archived: true);
        await service.CreateAsync(userId, new CreateVehicleRequest(
            "Still Active", null, null, null, null, null, null, null, null, null, null));

        var active = await service.ListAsync(userId, includeArchived: false);

        Assert.Single(active);
        Assert.Equal("Still Active", active[0].Nickname);
    }
}
