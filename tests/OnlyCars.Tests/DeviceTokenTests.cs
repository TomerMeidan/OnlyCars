using Microsoft.EntityFrameworkCore;
using System.Reflection;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OnlyCars.Api.Common;
using OnlyCars.Api.Controllers;
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

    // --- The device endpoint (security review, 2026-11-11) ---

    private DeviceController Device(Guid? owner = null) => new(vehicles, odometer)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, (owner ?? userId).ToString())], DeviceTokenAuthHandler.SchemeName))
            }
        }
    };

    private static OdometerReadingDto Value(ActionResult<OdometerReadingDto> result) => Assert.IsType<OdometerReadingDto>(Assert.IsType<OkObjectResult>(result.Result).Value);

    [Fact]
    public async Task DeviceReading_CantConfirmACorrection_SoItCantLowerTheOdometer()
    {
        var carId = await CreateCarAsync(1000);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            Device().AddReading(carId, new AddOdometerReadingRequest(10, Today, ConfirmCorrection: true), default));

        Assert.Equal("odometer.lowerThanPrevious", ex.Code);
        Assert.Equal(1000, (await vehicles.GetAsync(userId, carId)).CurrentOdometerKm);
    }

    [Fact]
    public async Task DeviceReading_OnAnotherUsersCar_IsNotFound_AndNothingIsAdded()
    {
        var carId = await CreateCarAsync(1000);

        await Assert.ThrowsAsync<NotFoundException>(() =>
            Device(Guid.NewGuid()).AddReading(carId, new AddOdometerReadingRequest(1200, Today), default));

        Assert.Single(await odometer.HistoryAsync(userId, carId));
    }

    [Fact]
    public async Task DeviceReading_OnAnArchivedCar_IsNotFound()
    {
        var carId = await CreateCarAsync(1000);
        await vehicles.ArchiveAsync(userId, carId, true);

        await Assert.ThrowsAsync<NotFoundException>(() =>
            Device().AddReading(carId, new AddOdometerReadingRequest(1200, Today), default));
    }

    [Fact]
    public async Task DeviceVehicles_ListsOnlyTheCallersCarsThatArentArchived()
    {
        var kept = await CreateCarAsync(1000);
        var archived = await CreateCarAsync(2000);
        await vehicles.ArchiveAsync(userId, archived, true);
        await vehicles.CreateAsync(Guid.NewGuid(), new CreateVehicleRequest("Theirs", null, null, null, null, null, null, null, null, null, 5));

        var listed = Assert.IsType<List<DeviceVehicleDto>>(Assert.IsType<OkObjectResult>((await Device().Vehicles(default)).Result).Value);

        Assert.Equal(kept, Assert.Single(listed).Id);
    }

    [Fact]
    public async Task DeviceReadings_AreCappedPerCarPerDay_ButAResendIsStillAnswered()
    {
        var carId = await CreateCarAsync(1000);
        var first = Guid.NewGuid();
        for (var i = 1; i <= OdometerService.MaxDeviceReadingsPerDay; i++)
        {
            Value(await Device().AddReading(carId, new AddOdometerReadingRequest(1000 + i, Today, ClientRequestId: i == 1 ? first : Guid.NewGuid()), default));
        }

        var ex = await Assert.ThrowsAsync<TooManyRequestsException>(() =>
            Device().AddReading(carId, new AddOdometerReadingRequest(2000, Today, ClientRequestId: Guid.NewGuid()), default));
        Assert.Equal("odometer.deviceTooMany", ex.Code);

        var resent = Value(await Device().AddReading(carId, new AddOdometerReadingRequest(1001, Today, ClientRequestId: first), default));
        Assert.Equal(1001, resent.ValueKm);
    }

    [Fact]
    public async Task TypedReadings_DontCountTowardTheDeviceCap()
    {
        var carId = await CreateCarAsync(1000);
        for (var i = 1; i <= OdometerService.MaxDeviceReadingsPerDay; i++)
        {
            await odometer.AddAsync(userId, carId, new AddOdometerReadingRequest(1000 + i, Today));
        }

        for (var i = 1; i <= OdometerService.MaxDeviceReadingsPerDay; i++)
        {
            Value(await Device().AddReading(carId, new AddOdometerReadingRequest(1100 + i, Today), default));
        }
    }

    [Fact]
    public async Task DeviceReading_TooFarAboveThePreviousOne_IsRefused()
    {
        var carId = await CreateCarAsync(1000);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            Device().AddReading(carId, new AddOdometerReadingRequest(10_000_000, Today), default));

        Assert.Equal("odometer.deviceImplausible", ex.Code);
        Assert.Equal(1000, (await vehicles.GetAsync(userId, carId)).CurrentOdometerKm);
    }

    [Fact]
    public async Task DeviceReading_AllowanceGrowsWithTheDaysSinceThePreviousReading()
    {
        var carId = (await vehicles.CreateAsync(userId, new CreateVehicleRequest("Car", null, null, null, null, null, null, null, null, null, null))).Id;
        await odometer.AddAsync(userId, carId, new AddOdometerReadingRequest(1000, Today.AddDays(-4)));
        var allowed = 1000 + 4 * OdometerService.MaxDeviceKmPerDay; // four days since day -4

        await Assert.ThrowsAsync<ValidationFailedException>(() =>
            Device().AddReading(carId, new AddOdometerReadingRequest(allowed + 1, Today), default));
        Assert.Equal(allowed, Value(await Device().AddReading(carId, new AddOdometerReadingRequest(allowed, Today), default)).ValueKm);
    }

    [Fact]
    public async Task ManyDevicePostsOnOneDay_ShareThatDaysAllowance()
    {
        var carId = (await vehicles.CreateAsync(userId, new CreateVehicleRequest("Car", null, null, null, null, null, null, null, null, null, null))).Id;
        await odometer.AddAsync(userId, carId, new AddOdometerReadingRequest(1000, Today.AddDays(-1)));
        var limit = OdometerService.MaxDeviceKmPerDay;

        // Each post tries to climb a full day's allowance above the one before it.
        var accepted = 0;
        for (var i = 1; i <= OdometerService.MaxDeviceReadingsPerDay; i++)
        {
            try
            {
                await Device().AddReading(carId, new AddOdometerReadingRequest(1000 + i * limit, Today), default);
                accepted++;
            }
            catch (ValidationFailedException ex) when (ex.Code == "odometer.deviceImplausible")
            {
            }
        }

        Assert.Equal(1, accepted);
        Assert.Equal(1000 + limit, (await vehicles.GetAsync(userId, carId)).CurrentOdometerKm);
    }

    [Fact]
    public async Task DeviceResend_AfterTheCarWasArchived_StillReturnsTheSavedReading()
    {
        var carId = await CreateCarAsync(1000);
        var id = Guid.NewGuid();
        var saved = Value(await Device().AddReading(carId, new AddOdometerReadingRequest(1200, Today, ClientRequestId: id), default));
        await vehicles.ArchiveAsync(userId, carId, true);

        var resent = Value(await Device().AddReading(carId, new AddOdometerReadingRequest(1200, Today, ClientRequestId: id), default));

        Assert.Equal(saved.Id, resent.Id);
    }

    [Fact]
    public void OnlyTheDeviceController_AcceptsDeviceTokens_AndNoneOfItsActionsAreAnonymous()
    {
        var controllers = typeof(DeviceController).Assembly.GetTypes().Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract).ToList();
        string? Schemes(MemberInfo m) => m.GetCustomAttributes<AuthorizeAttribute>().Select(a => a.AuthenticationSchemes).FirstOrDefault(s => s is not null);

        var withDevice = controllers.Where(c => Schemes(c)?.Contains(DeviceTokenAuthHandler.SchemeName) == true
            || c.GetMethods().Any(m => Schemes(m)?.Contains(DeviceTokenAuthHandler.SchemeName) == true)).ToList();

        Assert.Equal(typeof(DeviceController), Assert.Single(withDevice));
        Assert.Equal(DeviceTokenAuthHandler.SchemeName, Schemes(typeof(DeviceController)));
        Assert.DoesNotContain(typeof(DeviceController).GetMethods(), m => m.GetCustomAttributes<AllowAnonymousAttribute>().Any());
    }

    private sealed class SchemeOptions : IOptionsMonitor<AuthenticationSchemeOptions>
    {
        public AuthenticationSchemeOptions CurrentValue { get; } = new();
        public AuthenticationSchemeOptions Get(string? name) => CurrentValue;
        public IDisposable? OnChange(Action<AuthenticationSchemeOptions, string?> listener) => null;
    }

    private async Task<AuthenticateResult> AuthenticateAsync(string? header)
    {
        var context = new DefaultHttpContext();
        if (header is not null)
        {
            context.Request.Headers.Authorization = header;
        }

        var handler = new DeviceTokenAuthHandler(new SchemeOptions(), NullLoggerFactory.Instance, UrlEncoder.Default, tokens);
        await handler.InitializeAsync(new AuthenticationScheme(DeviceTokenAuthHandler.SchemeName, null, typeof(DeviceTokenAuthHandler)), context);
        return await handler.AuthenticateAsync();
    }

    [Fact]
    public async Task Handler_AcceptsAValidToken_AsItsUser()
    {
        var created = await CreateAsync();

        var result = await AuthenticateAsync("Bearer " + created.Token);

        Assert.True(result.Succeeded);
        Assert.Equal(userId.ToString(), result.Principal!.FindFirstValue(ClaimTypes.NameIdentifier));
    }

    [Theory]
    [InlineData("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln")]
    [InlineData("Bearer ocd_madeup")]
    public async Task Handler_RefusesASignInTokenOrAnUnknownOne(string header)
    {
        await CreateAsync();
        var result = await AuthenticateAsync(header);
        Assert.False(result.Succeeded);
        Assert.NotNull(result.Failure);
    }

    [Fact]
    public async Task Handler_WithoutABearerHeader_HasNoResult()
    {
        Assert.True((await AuthenticateAsync(null)).None);
        Assert.True((await AuthenticateAsync("Basic abc")).None);
    }

    [Fact]
    public async Task Handler_RefusesARevokedToken()
    {
        var created = await CreateAsync();
        await tokens.RevokeAsync(userId, created.Id);
        Assert.False((await AuthenticateAsync("Bearer " + created.Token)).Succeeded);
    }
}

/// <summary>OBD-1 on Postgres: the device cap holds when a device's posts arrive at the same time.</summary>
public class DeviceReadingSqlTests : IAsyncLifetime
{
    private readonly string connection = TestDbContextFactory.NewPostgresConnection();
    private readonly Guid userId = Guid.NewGuid();

    private AppDbContext NewContext() => new(TestDbContextFactory.PostgresOptions(connection).Options);

    public async Task InitializeAsync()
    {
        await using var db = NewContext();
        await db.Database.MigrateAsync();
        db.Users.Add(new OnlyCars.Domain.Entities.User { Id = userId, Email = "device@onlycars.test", PasswordHash = "x" });
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        await db.Database.EnsureDeletedAsync();
    }

    [Fact]
    public async Task ParallelDevicePosts_CantGoPastTheDailyCap()
    {
        Guid carId;
        await using (var db = NewContext())
        {
            carId = (await new VehicleService(db).CreateAsync(userId,
                new CreateVehicleRequest("Car", null, null, null, null, null, null, null, null, null, 1000))).Id;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var posts = Enumerable.Range(1, OdometerService.MaxDeviceReadingsPerDay + 10).Select(async i =>
        {
            await using var db = NewContext();
            var service = new OdometerService(db, new VehicleService(db));
            try
            {
                await service.AddFromDeviceAsync(userId, carId, new AddOdometerReadingRequest(1000 + i, today, ClientRequestId: Guid.NewGuid()));
                return true;
            }
            catch (TooManyRequestsException)
            {
                return false;
            }
            catch (ValidationFailedException)
            {
                return false; // a lower value arriving after a higher one: fine, it's refused
            }
        });
        await Task.WhenAll(posts);

        await using var check = NewContext();
        var saved = await check.OdometerReadings.CountAsync(r => r.VehicleId == carId && r.Source == OdometerSource.Obd);
        Assert.InRange(saved, 1, OdometerService.MaxDeviceReadingsPerDay);
    }
}
