using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Tires;

/// <summary>One tire per wheel, its checks and rotations (TIRE-2, decisions.md "TIRE-2 details (delegated)").</summary>
// shortcut: checks and rotations add no odometer reading (decided in MVP5-E); revisit if users expect it.
public class TireService(IAppDbContext db, VehicleService vehicleService, MaintenanceTaskService taskService)
{
    // shortcut: the check list returns the newest 50 dates; page it if users need older ones.
    public const int MaxCheckDatesListed = 50;

    // A rotation parks its tires on Position + 10 first (see MoveAsync); TirePosition has 5 values.
    private const int ParkOffset = 10;

    // Replace takes one position, a pair or the four; the spare only alone.
    private static readonly TirePosition[][] Groups =
        [[TirePosition.FL, TirePosition.FR], [TirePosition.RL, TirePosition.RR], [TirePosition.FL, TirePosition.FR, TirePosition.RL, TirePosition.RR]];

    public async Task<VehicleTiresDto> GetVehicleTiresAsync(Guid userId, Guid vehicleId, CancellationToken ct = default) =>
        await VehicleTiresAsync(await vehicleService.FindOwnedAsync(userId, vehicleId, ct), ct);

    /// <summary>
    /// Closes the tire on each position at the date and km, fits a new one per position and, unless every position was empty and no
    /// cost or shop was given, creates a task-less service record through the POST service-records path. One save.
    /// </summary>
    public async Task<VehicleTiresDto> ReplaceAsync(Guid userId, Guid vehicleId, ReplaceTiresRequest request, CancellationToken ct = default)
    {
        var vehicle = await FindActiveVehicleAsync(userId, vehicleId, ct);
        var sorted = (request.Positions ?? []).Order().ToList();
        if (!(sorted is [var one] && Enum.IsDefined(one) || Groups.Any(g => g.SequenceEqual(sorted))))
        {
            throw new ValidationFailedException("tire.invalidPositions", "Pick one wheel, the front pair, the rear pair, all four, or the spare.");
        }

        var details = new Tire { Brand = "" };
        Apply(details, request.Brand, request.Model, request.Size, request.Season, request.DotCode, request.PurchaseDate, request.Notes);
        var (date, km) = Validate(request.Date, request.OdometerKm);

        var old = await db.Tires.Where(t => t.VehicleId == vehicle.Id && t.RemovedAt == null && sorted.Contains(t.Position))
            .OrderBy(t => t.Position).ToListAsync(ct);
        foreach (var tire in old)
        {
            RejectBeforeFitted(tire, date, km);
        }

        // Before its last rotation a tire was on another wheel, so it can't have come off this one then.
        var oldIds = old.Select(t => t.Id).ToList();
        if (await db.TireRotationMoves.Where(m => oldIds.Contains(m.TireId)).MaxAsync(m => (DateOnly?)m.TireRotation!.Date, ct) is { } rotated
            && date < rotated)
        {
            throw new ValidationFailedException("tire.dateBeforeRotation", "The date is before the last rotation of these tires.")
            {
                Extensions = { ["latestDate"] = rotated }
            };
        }

        // shortcut: two simultaneous replaces at the cap can both pass; harmless, add a lock if the limit ever matters.
        if (await db.Tires.CountAsync(t => t.VehicleId == vehicle.Id, ct) + sorted.Count > Tire.MaxPerVehicle)
        {
            throw new ValidationFailedException("tire.limitReached", $"A car can have up to {Tire.MaxPerVehicle} tires, removed ones included.")
            {
                Extensions = { ["max"] = Tire.MaxPerVehicle }
            };
        }

        // Entering the tires already on the car buys nothing, so it records no service.
        ServiceRecord? record = null;
        if (old.Count > 0 || request.Cost is not null || !string.IsNullOrWhiteSpace(request.ShopName))
        {
            (record, _) = await taskService.StageRecordAsync(vehicle,
                new CreateServiceRecordRequest(date, km, request.ShopName, request.Cost, request.Notes, null, request.ConfirmCorrection), date, ct);
        }

        var now = DateTimeOffset.UtcNow;
        foreach (var tire in old)
        {
            (tire.RemovedAt, tire.RemovedOdometerKm, tire.UpdatedAt) = (date, km, now);
        }

        db.Tires.AddRange(sorted.Select(p => new Tire
        {
            VehicleId = vehicle.Id, Position = p, Brand = details.Brand, Model = details.Model, Size = details.Size, Season = details.Season,
            DotCode = details.DotCode, PurchaseDate = details.PurchaseDate, Notes = details.Notes,
            FittedAt = date, FittedOdometerKm = km, ServiceRecordId = record?.Id
        }));
        await SaveAsync(ct);
        return await VehicleTiresAsync(vehicle, ct);
    }

    /// <summary>The detail fields only; allowed on a removed tire and an archived car.</summary>
    public async Task<TireDto> UpdateAsync(Guid userId, Guid id, UpdateTireRequest request, CancellationToken ct = default)
    {
        var tire = await FindTireAsync(userId, id, ct);
        Apply(tire, request.Brand, request.Model, request.Size, request.Season, request.DotCode, request.PurchaseDate, request.Notes);
        tire.UpdatedAt = DateTimeOffset.UtcNow;
        await SaveAsync(ct);
        return (await TireDtosAsync(db.Tires.Where(t => t.Id == tire.Id), tire.Vehicle!.CurrentOdometerKm, ct)).Single();
    }

    /// <summary>Fixes a mistake: the tire and its measurements go; the wheel is left empty. Its service record stays.</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        var tire = await FindTireAsync(userId, id, ct);
        if (await db.TireRotationMoves.AnyAsync(m => m.TireId == tire.Id, ct))
        {
            throw new ConflictException("tire.rotated", "A rotation moved this tire. Delete that rotation first.");
        }

        // Loaded so the delete also cascades on providers without database cascades (tests).
        await db.TireMeasurements.Where(m => m.TireId == tire.Id).LoadAsync(ct);
        db.Tires.Remove(tire);
        await SaveAsync(ct);
    }

    // --- Checks: a check is the car's measurements of one date ---

    public async Task<List<TireCheckDto>> ListChecksAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var measurements = db.TireMeasurements.Where(m => m.Tire!.VehicleId == vehicle.Id);
        var dates = await measurements.Select(m => m.MeasuredAt).Distinct().OrderByDescending(d => d).Take(MaxCheckDatesListed).ToListAsync(ct);
        return await ChecksAsync(measurements.Where(m => dates.Contains(m.MeasuredAt)), ct);
    }

    /// <summary>Attaches each measurement to the tire on that wheel now; returns that date's whole check.</summary>
    public async Task<TireCheckDto> AddCheckAsync(Guid userId, Guid vehicleId, TireCheckRequest request, CancellationToken ct = default)
    {
        var vehicle = await FindActiveVehicleAsync(userId, vehicleId, ct);
        var date = ValidateDate(request.MeasuredAt);
        if (request.Items is not { Count: > 0 } items)
        {
            throw new ValidationFailedException("tireMeasurement.empty", "Enter a pressure or a tread depth.");
        }

        var onCar = await db.Tires.Where(t => t.VehicleId == vehicle.Id && t.RemovedAt == null).ToListAsync(ct);
        var rows = new List<TireMeasurement>();
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (item?.Position is not { } p || !Enum.IsDefined(p))
            {
                throw Item("tireMeasurement.invalidPosition", "Pick a wheel.", i);
            }

            var (pressure, tread) = (item.PressureBar, item.TreadDepthMm);
            if (pressure is null && tread is null)
            {
                throw Item("tireMeasurement.empty", "Enter a pressure or a tread depth.", i);
            }

            // More decimals than the column keeps (2 and 1) is rejected rather than silently rounded.
            if (pressure is { } bar && (bar is < TireMeasurement.MinPressureBar or > TireMeasurement.MaxPressureBar || bar != Math.Round(bar, 2)))
            {
                throw Item("tireMeasurement.invalidPressure",
                    $"The pressure must be {TireMeasurement.MinPressureBar} to {TireMeasurement.MaxPressureBar} bar, up to 2 decimals.", i);
            }

            if (tread is { } mm && (mm is < 0 or > TireMeasurement.MaxTreadDepthMm || mm != Math.Round(mm, 1)))
            {
                throw Item("tireMeasurement.invalidTread", $"The tread depth must be 0 to {TireMeasurement.MaxTreadDepthMm} mm, up to 1 decimal.", i);
            }

            if (rows.Any(r => r.Position == p))
            {
                throw Item("tireMeasurement.duplicatePosition", "Each wheel can appear once.", i);
            }

            var tire = onCar.FirstOrDefault(t => t.Position == p) ?? throw Item("tireMeasurement.noTire", "There is no tire on this wheel.", i, p);
            if (date < tire.FittedAt)
            {
                throw BeforeFitted(tire, i);
            }

            rows.Add(new TireMeasurement { TireId = tire.Id, Position = p, MeasuredAt = date, PressureBar = pressure, TreadDepthMm = tread });
        }

        var tireIds = rows.Select(r => r.TireId).ToList();
        var rowIds = rows.Select(r => r.Id).ToList();
        var sameDate = db.TireMeasurements.Where(m => tireIds.Contains(m.TireId) && m.MeasuredAt == date && !rowIds.Contains(m.Id));
        if (await sameDate.AnyAsync(ct))
        {
            throw DuplicateCheck(date);
        }

        // shortcut: two simultaneous checks at the cap can both pass; harmless, add a lock if the limit ever matters.
        var counts = await db.TireMeasurements.Where(m => tireIds.Contains(m.TireId)).GroupBy(m => m.TireId).Select(g => g.Count()).ToListAsync(ct);
        if (counts.Any(c => c >= TireMeasurement.MaxPerTire))
        {
            throw new ValidationFailedException("tireMeasurement.limitReached", $"A tire can have up to {TireMeasurement.MaxPerTire} measurements.")
            {
                Extensions = { ["max"] = TireMeasurement.MaxPerTire }
            };
        }

        db.TireMeasurements.AddRange(rows);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A simultaneous check of the same tire on the same date won the unique (tire, date) index.
            if (await sameDate.AnyAsync(ct))
            {
                throw DuplicateCheck(date);
            }

            throw;
        }

        return (await ChecksAsync(db.TireMeasurements.Where(m => m.Tire!.VehicleId == vehicle.Id && m.MeasuredAt == date), ct)).Single();
    }

    /// <summary>Deletes every measurement of the car on that date, removed tires' too. Allowed on an archived car.</summary>
    public async Task DeleteCheckAsync(Guid userId, Guid vehicleId, DateOnly measuredAt, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var rows = await db.TireMeasurements.Where(m => m.Tire!.VehicleId == vehicle.Id && m.MeasuredAt == measuredAt).ToListAsync(ct);
        if (rows.Count == 0)
        {
            throw new NotFoundException(nameof(TireMeasurement), measuredAt);
        }

        db.TireMeasurements.RemoveRange(rows);
        await db.SaveChangesAsync(ct);
    }

    // --- Rotations ---

    public async Task<List<TireRotationDto>> ListRotationsAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        return await Newest(db.TireRotations.Where(r => r.VehicleId == vehicle.Id))
            .Select(r => new TireRotationDto(r.Id, r.Date, r.OdometerKm, r.Notes, r.Moves.OrderBy(m => m.FromPosition)
                .Select(m => new TireRotationMoveDto(m.TireId, m.FromPosition, m.ToPosition)).ToList()))
            .ToListAsync(ct);
    }

    /// <summary>
    /// Moves the tires as a permutation of occupied wheels: every from holds a tire, the to positions are the from positions, none twice,
    /// and no tire stays on its wheel. Not dated before the car's newest rotation, so the newest is always the last applied and deleting it
    /// puts the tires back.
    /// </summary>
    public async Task<TireRotationDto> AddRotationAsync(Guid userId, Guid vehicleId, TireRotationRequest request, CancellationToken ct = default)
    {
        var vehicle = await FindActiveVehicleAsync(userId, vehicleId, ct);
        var (date, km) = Validate(request.Date, request.OdometerKm);
        var notes = Optional(request.Notes, TireRotation.MaxNotesLength, "tireRotation.invalidNotes", "Notes");
        var moves = request.Moves ?? [];
        var froms = moves.Select(m => m?.FromPosition).ToList();
        var tos = moves.Select(m => m?.ToPosition).ToList();
        if (moves.Count == 0 || froms.Concat(tos).Any(p => p is not { } v || !Enum.IsDefined(v))
            || froms.Distinct().Count() != froms.Count || !froms.Order().SequenceEqual(tos.Order()) || froms.Zip(tos).Any(p => p.First == p.Second))
        {
            throw new ValidationFailedException("tireRotation.invalidMoves",
                "Each tire must move to another wheel, each wheel can appear once as a from and once as a to, and the tires must land on the wheels they left.");
        }

        var onCar = await db.Tires.Where(t => t.VehicleId == vehicle.Id && t.RemovedAt == null).ToListAsync(ct);
        var rotation = new TireRotation { VehicleId = vehicle.Id, Date = date, OdometerKm = km, Notes = notes };
        var placed = new List<(Tire Tire, TirePosition To)>();
        for (var i = 0; i < moves.Count; i++)
        {
            var (from, to) = (froms[i]!.Value, tos[i]!.Value);
            var tire = onCar.FirstOrDefault(t => t.Position == from) ?? throw Item("tireRotation.noTire", "There is no tire on this wheel.", i, from);
            if (date < tire.FittedAt)
            {
                throw BeforeFitted(tire, i);
            }

            rotation.Moves.Add(new TireRotationMove { TireId = tire.Id, FromPosition = from, ToPosition = to });
            placed.Add((tire, to));
        }

        var rotations = db.TireRotations.Where(r => r.VehicleId == vehicle.Id);
        if (await Newest(rotations).Select(r => (DateOnly?)r.Date).FirstOrDefaultAsync(ct) is { } latest && date < latest)
        {
            throw new ValidationFailedException("tireRotation.beforeLatest", "The date is before the car's last rotation.")
            {
                Extensions = { ["latestDate"] = latest }
            };
        }

        // shortcut: two simultaneous rotations at the cap can both pass; harmless, add a lock if the limit ever matters.
        if (await rotations.CountAsync(ct) >= TireRotation.MaxPerVehicle)
        {
            throw new ValidationFailedException("tireRotation.limitReached", $"A car can have up to {TireRotation.MaxPerVehicle} rotations.")
            {
                Extensions = { ["max"] = TireRotation.MaxPerVehicle }
            };
        }

        db.TireRotations.Add(rotation);
        await MoveAsync(placed, ct);
        return new TireRotationDto(rotation.Id, rotation.Date, rotation.OdometerKm, rotation.Notes, rotation.Moves.OrderBy(m => m.FromPosition)
            .Select(m => new TireRotationMoveDto(m.TireId, m.FromPosition, m.ToPosition)).ToList());
    }

    /// <summary>Only the car's newest rotation, and it moves its tires back. Allowed on an archived car.</summary>
    public async Task DeleteRotationAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        var rotation = await db.TireRotations.Include(r => r.Moves).ThenInclude(m => m.Tire)
                           .FirstOrDefaultAsync(r => r.Id == id && r.Vehicle!.UserId == userId, ct)
                       ?? throw new NotFoundException(nameof(TireRotation), id);
        if (await Newest(db.TireRotations.Where(r => r.VehicleId == rotation.VehicleId)).Select(r => r.Id).FirstAsync(ct) != rotation.Id)
        {
            throw new ConflictException("tireRotation.notLatest", "Only the newest rotation can be deleted.");
        }

        if (rotation.Moves.Any(m => m.Tire!.RemovedAt is not null))
        {
            throw new ConflictException("tireRotation.tireRemoved", "A tire of this rotation has been removed since, so it can't be put back.");
        }

        db.TireRotations.Remove(rotation);
        await MoveAsync(rotation.Moves.Select(m => (m.Tire!, m.FromPosition)).ToList(), ct);
    }

    // The database checks the one-tire-per-wheel index after each row's UPDATE, so a swap would collide: the tires are parked on unused
    // positions in a first save and placed in a second, in one transaction. The pending changes (the rotation) go with the first save.
    private async Task MoveAsync(List<(Tire Tire, TirePosition To)> moves, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var now = DateTimeOffset.UtcNow;
        foreach (var (tire, to) in moves)
        {
            (tire.Position, tire.UpdatedAt) = ((TirePosition)(ParkOffset + (int)to), now);
        }

        await SaveAsync(ct);
        foreach (var (tire, to) in moves)
        {
            tire.Position = to;
        }

        await SaveAsync(ct);
        await transaction.CommitAsync(ct);
    }

    // Newest first: by date, then the later-created (AddRotation keeps that the order they were applied in).
    private static IQueryable<TireRotation> Newest(IQueryable<TireRotation> rotations) =>
        rotations.OrderByDescending(r => r.Date).ThenByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id);

    private async Task<List<TireCheckDto>> ChecksAsync(IQueryable<TireMeasurement> measurements, CancellationToken ct) =>
        (await measurements.Select(m => new { m.MeasuredAt, Item = new TireCheckItemDto(m.TireId, m.Position, m.PressureBar, m.TreadDepthMm) })
            .ToListAsync(ct))
        .GroupBy(m => m.MeasuredAt).OrderByDescending(g => g.Key)
        .Select(g => new TireCheckDto(g.Key, g.Select(m => m.Item).OrderBy(i => i.Position).ThenBy(i => i.TireId).ToList()))
        .ToList();

    private async Task<VehicleTiresDto> VehicleTiresAsync(Vehicle vehicle, CancellationToken ct)
    {
        var tires = await TireDtosAsync(db.Tires.Where(t => t.VehicleId == vehicle.Id), vehicle.CurrentOdometerKm, ct);
        var lastCheck = await db.TireMeasurements.Where(m => m.Tire!.VehicleId == vehicle.Id).MaxAsync(m => (DateOnly?)m.MeasuredAt, ct);
        var last = await Newest(db.TireRotations.Where(r => r.VehicleId == vehicle.Id)).Select(r => new { r.Id, r.Date, r.OdometerKm })
            .FirstOrDefaultAsync(ct);
        return new VehicleTiresDto(tires.Where(t => t.RemovedAt is null).OrderBy(t => t.Position).ToList(), tires.Where(t => t.RemovedAt is not null).ToList(),
            lastCheck, last is null ? null : new LastTireRotationDto(last.Id, last.Date, last.OdometerKm, Math.Max(0, vehicle.CurrentOdometerKm - last.OdometerKm)));
    }

    // Removed tires newest removal first. Where tires on the car (RemovedAt null) land differs by database, and the one caller that lists several splits them.
    private async Task<List<TireDto>> TireDtosAsync(IQueryable<Tire> tires, decimal currentKm, CancellationToken ct) =>
        (await tires.AsNoTracking()
            .OrderByDescending(t => t.RemovedAt).ThenByDescending(t => t.RemovedOdometerKm).ThenByDescending(t => t.CreatedAt)
            .Select(t => new
            {
                Tire = t,
                Latest = t.Measurements.OrderByDescending(m => m.MeasuredAt)
                    .Select(m => new TireMeasurementDto(m.MeasuredAt, m.Position, m.PressureBar, m.TreadDepthMm)).FirstOrDefault()
            })
            .ToListAsync(ct))
        .Select(x => new TireDto(x.Tire.Id, x.Tire.Position, x.Tire.Brand, x.Tire.Model, x.Tire.Size, x.Tire.Season, x.Tire.DotCode,
            DotDate(x.Tire.DotCode), x.Tire.PurchaseDate, x.Tire.FittedAt, x.Tire.FittedOdometerKm, x.Tire.RemovedAt, x.Tire.RemovedOdometerKm,
            Math.Max(0, (x.Tire.RemovedOdometerKm ?? currentKm) - x.Tire.FittedOdometerKm), x.Tire.Notes, x.Tire.ServiceRecordId, x.Latest))
        .ToList();

    /// <summary>The Monday of the DOT week when the code ends in 4 digits WWYY with WW 01 to 53 (year 20YY), else null.</summary>
    public static DateOnly? DotDate(string? dotCode)
    {
        if (dotCode is not { Length: >= 4 } || !dotCode[^4..].All(char.IsAsciiDigit))
        {
            return null;
        }

        var week = int.Parse(dotCode[^4..^2], CultureInfo.InvariantCulture);
        var year = 2000 + int.Parse(dotCode[^2..], CultureInfo.InvariantCulture);
        return week is >= 1 and <= 53 ? DateOnly.FromDateTime(ISOWeek.ToDateTime(year, week, DayOfWeek.Monday)) : null;
    }

    private async Task SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A simultaneous replace or rotation of the same car won the one-tire-per-wheel index or changed the same tire (UpdatedAt token).
            throw new ConflictException("concurrency.conflict", "This was changed at the same time somewhere else. Reload and try again.");
        }
    }

    // Scoped to the owner, so another user's car is simply not found. Checks, rotations and replacements need an active car.
    private async Task<Vehicle> FindActiveVehicleAsync(Guid userId, Guid vehicleId, CancellationToken ct)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        return vehicle.IsArchived ? throw new ValidationFailedException("tire.vehicleArchived", "This car is archived.") : vehicle;
    }

    // Scoped to the owner through the car, so another user's tire is simply not found.
    private async Task<Tire> FindTireAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.Tires.Include(t => t.Vehicle).FirstOrDefaultAsync(t => t.Id == id && t.Vehicle!.UserId == userId, ct)
        ?? throw new NotFoundException(nameof(Tire), id);

    // Removal (and any check or rotation) is not before the tire was fitted; the database checks the same for removal.
    private static void RejectBeforeFitted(Tire tire, DateOnly date, decimal km)
    {
        if (date < tire.FittedAt)
        {
            throw BeforeFitted(tire, null);
        }

        if (km < tire.FittedOdometerKm)
        {
            throw new ValidationFailedException("tire.odometerBeforeFitted", "The odometer is below the odometer when the tire was fitted.")
            {
                Extensions = { ["fittedOdometerKm"] = tire.FittedOdometerKm, ["position"] = tire.Position.ToString() }
            };
        }
    }

    private static ValidationFailedException BeforeFitted(Tire tire, int? index)
    {
        var ex = new ValidationFailedException("tire.dateBeforeFitted", "The date is before the tire was fitted.")
        {
            Extensions = { ["fittedAt"] = tire.FittedAt, ["position"] = tire.Position.ToString() }
        };
        if (index is { } i) ex.Extensions["index"] = i;
        return ex;
    }

    private static ValidationFailedException Item(string code, string message, int index, TirePosition? position = null)
    {
        var ex = new ValidationFailedException(code, message) { Extensions = { ["index"] = index } };
        if (position is { } p) ex.Extensions["position"] = p.ToString();
        return ex;
    }

    private static ConflictException DuplicateCheck(DateOnly date) =>
        new("tireMeasurement.duplicate", "A tire was already measured on this date. Delete that check to log it again.")
        {
            Extensions = { ["measuredAt"] = date }
        };

    private static (DateOnly Date, decimal Km) Validate(DateOnly? date, decimal? odometerKm)
    {
        var d = ValidateDate(date);
        if (odometerKm is not { } km || km is < 0 or > OdometerReading.MaxValueKm)
        {
            throw new ValidationFailedException("odometer.invalidValue", $"The odometer must be between 0 and {OdometerReading.MaxValueKm} km.");
        }

        return (d, km);
    }

    private static DateOnly ValidateDate(DateOnly? date)
    {
        // Same one day of slack as readings: the client sends its local date.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var d = date ?? today;
        DateRules.RejectTooEarly(d);
        return d > today.AddDays(1) ? throw new ValidationFailedException("tire.futureDate", "The date can't be in the future.") : d;
    }

    private static void Apply(Tire tire, string? brand, string? model, string? size, TireSeason? season, string? dotCode, DateOnly? purchaseDate,
        string? notes)
    {
        var b = brand?.Trim() ?? "";
        if (b.Length is 0 or > Tire.MaxBrandLength)
        {
            throw new ValidationFailedException("tire.invalidBrand", $"The brand must be 1 to {Tire.MaxBrandLength} characters.");
        }

        var m = Optional(model, Tire.MaxModelLength, "tire.invalidModel", "The model");
        var s = Optional(size, Tire.MaxSizeLength, "tire.invalidSize", "The size");
        var dot = Optional(dotCode, Tire.MaxDotCodeLength, "tire.invalidDotCode", "The DOT code");
        var n = Optional(notes, Tire.MaxNotesLength, "tire.invalidNotes", "Notes");
        if (season is not { } se || !Enum.IsDefined(se))
        {
            throw new ValidationFailedException("tire.invalidSeason", "Pick a season.");
        }

        if (purchaseDate is { } purchased)
        {
            DateRules.RejectTooEarly(purchased);
            if (purchased > DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1))
            {
                throw new ValidationFailedException("tire.futurePurchaseDate", "The purchase date can't be in the future.");
            }
        }

        (tire.Brand, tire.Model, tire.Size, tire.Season, tire.DotCode, tire.PurchaseDate, tire.Notes) = (b, m, s, se, dot, purchaseDate, n);
    }

    // Trimmed; blank is null.
    private static string? Optional(string? value, int max, string code, string field)
    {
        var v = value?.Trim() is { Length: > 0 } s ? s : null;
        return v?.Length > max ? throw new ValidationFailedException(code, $"{field} can be up to {max} characters.") : v;
    }
}
