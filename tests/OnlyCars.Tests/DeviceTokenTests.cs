using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Devices;
using OnlyCars.Application.Devices.Dtos;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>OBD-1: device tokens and readings from the OBD adapter app.</summary>
public class DeviceTokenTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly DeviceTokenService tokens;
    private readonly VehicleService vehicles;
    private readonly OdometerService odometer;
    private readonly Guid userId = Guid.NewGuid();

    public DeviceTokenTests()
    {
        tokens = new DeviceTokenService(db);
        vehicles = new VehicleService(db);
        odometer = new OdometerService(db, vehicles);
    }

    private Task<CreatedDeviceTokenDto> CreateAsync(string? name = "Phone", Guid? owner = null) =>
        tokens.CreateAsync(owner ?? userId, new CreateDeviceTokenRequest(name));

    private async Task<Guid> CreateCarAsync(decimal initialKm) =>
        (await vehicles.CreateAsync(userId, new CreateVehicleRequest("Car", null, null, null, null, null, null, null, null, null, initialKm))).Id;

    [Fact]
    public async Task Create_ReturnsTheTokenOnce_AndStoresOnlyItsHash()
    {
        var created = await CreateAsync("  My phone  ");

        Assert.StartsWith(DeviceTokenService.Prefix, created.Token);
        Assert.Equal("My phone", created.Name);
        var stored = Assert.Single(db.DeviceTokens);
        Assert.NotEqual(created.Token, stored.TokenHash);
        Assert.DoesNotContain(created.Token, stored.TokenHash);
        Assert.Equal(64, stored.TokenHash.Length);
    }

    [Fact]
    public async Task Create_TwoTokens_AreDifferent()
    {
        Assert.NotEqual((await CreateAsync()).Token, (await CreateAsync()).Token);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_WithoutAName_IsRejected(string? name)
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => CreateAsync(name));
        Assert.Equal("deviceToken.invalidName", ex.Code);
    }

    [Fact]
    public async Task Create_NameTooLong_IsRejected()
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => CreateAsync(new string('a', DeviceTokenService.MaxNameLength + 1)));
        Assert.Equal("deviceToken.invalidName", ex.Code);
    }

    [Fact]
    public async Task Create_AboveTheCap_IsRejected_ButAnotherUserIsNotAffected()
    {
        for (var i = 0; i < DeviceTokenService.MaxPerUser; i++)
        {
            await CreateAsync();
        }

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => CreateAsync());
        Assert.Equal("deviceToken.tooMany", ex.Code);
        await CreateAsync(owner: Guid.NewGuid());
    }

    [Fact]
    public async Task Authenticate_ValidToken_ReturnsItsUser_AndRecordsLastUse()
    {
        var created = await CreateAsync();

        Assert.Equal(userId, await tokens.AuthenticateAsync(created.Token));
        Assert.NotNull(Assert.Single(await tokens.ListAsync(userId)).LastUsedAt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ocd_notARealToken")]
    [InlineData("eyJhbGciOiJIUzI1NiJ9.e30.signature")]
    public async Task Authenticate_AnythingElse_ReturnsNull(string? token)
    {
        await CreateAsync();
        Assert.Null(await tokens.AuthenticateAsync(token));
    }

    [Fact]
    public async Task Revoke_EndsTheToken()
    {
        var created = await CreateAsync();

        await tokens.RevokeAsync(userId, created.Id);

        Assert.Null(await tokens.AuthenticateAsync(created.Token));
        Assert.Empty(await tokens.ListAsync(userId));
    }

    [Fact]
    public async Task Revoke_AnotherUsersToken_IsNotFound_AndTheTokenStillWorks()
    {
        var created = await CreateAsync();

        await Assert.ThrowsAsync<NotFoundException>(() => tokens.RevokeAsync(Guid.NewGuid(), created.Id));

        Assert.Equal(userId, await tokens.AuthenticateAsync(created.Token));
    }

    [Fact]
    public async Task List_ShowsOnlyTheUsersTokens_WithoutTheToken()
    {
        await CreateAsync("Mine");
        await CreateAsync("Theirs", Guid.NewGuid());

        var listed = Assert.Single(await tokens.ListAsync(userId));
        Assert.Equal("Mine", listed.Name);
        Assert.Null(listed.LastUsedAt);
    }

    [Fact]
    public async Task ObdReading_IsStoredWithItsSource_AndUpdatesTheCar()
    {
        var carId = await CreateCarAsync(1000);

        var reading = await odometer.AddAsync(userId, carId, new AddOdometerReadingRequest(1200, Today), default, OdometerSource.Obd);

        Assert.Equal(OdometerSource.Obd, reading.Source);
        Assert.Equal(1200, (await vehicles.GetAsync(userId, carId)).CurrentOdometerKm);
    }

    [Fact]
    public async Task ObdReading_ResentWithTheSameRequestId_IsNotAddedTwice()
    {
        var carId = await CreateCarAsync(1000);
        var request = new AddOdometerReadingRequest(1200, Today, ClientRequestId: Guid.NewGuid());

        var first = await odometer.AddAsync(userId, carId, request, default, OdometerSource.Obd);
        var second = await odometer.AddAsync(userId, carId, request, default, OdometerSource.Obd);

        Assert.Equal(first.Id, second.Id);
        Assert.Equal(2, (await odometer.HistoryAsync(userId, carId)).Count);
    }

    [Fact]
    public async Task ObdReading_CanBeCorrectedAndDeletedOnTheSite()
    {
        var carId = await CreateCarAsync(1000);
        var reading = await odometer.AddAsync(userId, carId, new AddOdometerReadingRequest(1200, Today), default, OdometerSource.Obd);

        var edited = await odometer.UpdateAsync(userId, carId, reading.Id, new UpdateOdometerReadingRequest(1150, Today));
        Assert.Equal(1150, edited.ValueKm);
        Assert.Equal(OdometerSource.Obd, edited.Source);

        await odometer.DeleteAsync(userId, carId, reading.Id);
        Assert.Equal(1000, (await vehicles.GetAsync(userId, carId)).CurrentOdometerKm);
    }

    [Fact]
    public async Task TypedReading_KeepsTheManualSource()
    {
        var carId = await CreateCarAsync(1000);
        Assert.Equal(OdometerSource.Manual, (await odometer.AddAsync(userId, carId, new AddOdometerReadingRequest(1200, Today))).Source);
    }
}
