using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Tires;

/// <summary>Tire sets, which set is on which car, and km per set (MVP5-D, decisions.md "Tires scope and split, MVP5-D").</summary>
// shortcut: mount and unmount record their odometer on the mount only and add no odometer reading (decided); revisit if users expect it.
public class TireService(IAppDbContext db, VehicleService vehicleService)
{
    // shortcut: a car's past mounts are capped at the newest 100; page them if a car ever has more.
    public const int MaxPastMountsListed = 100;

    public async Task<List<TireSetDto>> ListAsync(Guid userId, CancellationToken ct = default) =>
        await Project(db.TireSets.Where(s => s.UserId == userId)
            .OrderBy(s => s.Brand).ThenBy(s => s.Model).ThenBy(s => s.CreatedAt)).ToListAsync(ct);

    public async Task<TireSetDto> CreateAsync(Guid userId, TireSetRequest request, CancellationToken ct = default)
    {
        var set = new TireSet { UserId = userId, Brand = "" };
        Apply(set, request);

        // shortcut: two simultaneous creates at 49 can both pass and make 51; harmless, add a lock if the limit ever matters.
        if (await db.TireSets.CountAsync(s => s.UserId == userId, ct) >= TireSet.MaxPerUser)
        {
            throw new ValidationFailedException("tireSet.limitReached", $"You can have up to {TireSet.MaxPerUser} tire sets.");
        }

        db.TireSets.Add(set);
        await db.SaveChangesAsync(ct);
        return await SetDtoAsync(set.Id, ct);
    }

    public async Task<TireSetDto> UpdateAsync(Guid userId, Guid id, TireSetRequest request, CancellationToken ct = default)
    {
        var set = await FindSetAsync(userId, id, ct);
        Apply(set, request);
        set.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await SetDtoAsync(set.Id, ct);
    }

    /// <summary>Hard delete; its mounts go with it (cascade).</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        db.TireSets.Remove(await FindSetAsync(userId, id, ct));
        await db.SaveChangesAsync(ct);
    }

    public async Task<List<TireMountDto>> ListMountsAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        var set = await FindSetAsync(userId, id, ct);
        return await ProjectMounts(db.TireMounts.Where(m => m.TireSetId == set.Id)).ToListAsync(ct);
    }

    public async Task<VehicleTiresDto> GetVehicleTiresAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        return await VehicleTiresAsync(vehicle.Id, ct);
    }

    /// <summary>Mounts the set on the car; a set already on the car is unmounted at the same date and odometer in the same save (a swap).</summary>
    public async Task<VehicleTiresDto> MountAsync(Guid userId, Guid vehicleId, MountTireSetRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var set = await FindSetAsync(userId, request.TireSetId, ct);
        if (vehicle.IsArchived)
        {
            throw new ValidationFailedException("tireMount.vehicleArchived", "This car is archived.");
        }

        var (date, km) = Validate(request.MountedAt, request.OdometerKm);

        if (await db.TireMounts.AnyAsync(m => m.TireSetId == set.Id && m.UnmountedAt == null, ct))
        {
            throw new ConflictException("tireMount.setMounted", "This set is on a car. Unmount it there first.");
        }

        var open = await db.TireMounts.FirstOrDefaultAsync(m => m.VehicleId == vehicle.Id && m.UnmountedAt == null, ct);
        var lastEnd = await db.TireMounts.Where(m => (m.TireSetId == set.Id || m.VehicleId == vehicle.Id) && m.UnmountedAt != null)
            .MaxAsync(m => m.UnmountedAt, ct);
        if (date < open?.MountedAt || date < lastEnd)
        {
            throw Overlap();
        }

        if (open is not null)
        {
            Close(open, date, km);
        }

        // shortcut: two simultaneous mounts at 499 can both pass and make 501; harmless, add a lock if the limit ever matters.
        if (await db.TireMounts.CountAsync(m => m.TireSetId == set.Id, ct) >= TireSet.MaxMounts)
        {
            throw new ValidationFailedException("tireMount.limitReached", $"A tire set can have up to {TireSet.MaxMounts} mounts.");
        }

        db.TireMounts.Add(new TireMount { TireSetId = set.Id, VehicleId = vehicle.Id, MountedAt = date, MountOdometerKm = km });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A simultaneous mount of the same car or set won an open-mount unique index, or closed the same open mount.
            throw new ConflictException("concurrency.conflict", "This was changed at the same time somewhere else. Reload and try again.");
        }

        return await VehicleTiresAsync(vehicle.Id, ct);
    }

    /// <summary>Closes the car's open mount. Allowed on an archived car, so a set is never stuck on it.</summary>
    public async Task<VehicleTiresDto> UnmountAsync(Guid userId, Guid vehicleId, UnmountTireSetRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var (date, km) = Validate(request.UnmountedAt, request.OdometerKm);
        var open = await db.TireMounts.FirstOrDefaultAsync(m => m.VehicleId == vehicle.Id && m.UnmountedAt == null, ct)
            ?? throw new NotFoundException(nameof(TireMount), vehicle.Id);
        if (date < open.MountedAt)
        {
            throw Overlap();
        }

        Close(open, date, km);
        await db.SaveChangesAsync(ct);
        return await VehicleTiresAsync(vehicle.Id, ct);
    }

    /// <summary>Deletes one mount record to fix a mistake; deleting the open one leaves the car with no set.</summary>
    public async Task DeleteMountAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        db.TireMounts.Remove(await FindMountAsync(userId, id, withVehicle: false, ct));
        await db.SaveChangesAsync(ct);
    }

    // --- MVP5-E: checks and rotations (decisions.md "Tire measurements and rotations, MVP5-E") ---

    // shortcut: the check list returns the newest 50 dates; page it if users need older ones.
    public const int MaxCheckDatesListed = 50;

    public async Task<List<TireCheckDto>> ListChecksAsync(Guid userId, Guid mountId, CancellationToken ct = default) =>
        await ChecksAsync((await FindMountAsync(userId, mountId, withVehicle: false, ct)).Id, MaxCheckDatesListed, ct);

    public async Task<TireCheckDto> AddCheckAsync(Guid userId, Guid mountId, TireCheckRequest request, CancellationToken ct = default)
    {
        var mount = await FindOpenMountAsync(userId, mountId, ct);
        var date = ValidateDate(request.MeasuredAt);
        RejectBeforeMount(mount, date);
        if (request.Items is not { Count: > 0 } items)
        {
            throw new ValidationFailedException("tireMeasurement.empty", "Enter a pressure or a tread depth.");
        }

        var rows = new List<TireMeasurement>();
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (item?.Position is not { } p)
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

            rows.Add(new TireMeasurement { Position = p, PressureBar = pressure, TreadDepthMm = tread });
        }

        var checks = db.TireChecks.Where(c => c.TireMountId == mount.Id);
        if (await checks.AnyAsync(c => c.MeasuredAt == date, ct))
        {
            throw DuplicateCheck(date);
        }

        // shortcut: two simultaneous checks at 199 dates can both pass and make 201; harmless, add a lock if the limit ever matters.
        if (await checks.CountAsync(ct) >= TireCheck.MaxPerMount)
        {
            throw new ValidationFailedException("tireMeasurement.limitReached", $"A mount can have up to {TireCheck.MaxPerMount} checks.");
        }

        var check = new TireCheck { TireMountId = mount.Id, MeasuredAt = date, Measurements = rows };
        db.TireChecks.Add(check);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A simultaneous check on the same date won the unique (mount, date) index.
            if (await checks.AnyAsync(c => c.MeasuredAt == date && c.Id != check.Id, ct))
            {
                throw DuplicateCheck(date);
            }

            throw;
        }

        return new TireCheckDto(date, rows.OrderBy(r => r.Position).Select(r => new TireCheckItemDto(r.Position, r.PressureBar, r.TreadDepthMm)).ToList());
    }

    /// <summary>Deletes the whole check of that date. Allowed on a closed mount and an archived car.</summary>
    public async Task DeleteCheckAsync(Guid userId, Guid mountId, DateOnly measuredAt, CancellationToken ct = default)
    {
        var mount = await FindMountAsync(userId, mountId, withVehicle: false, ct);
        // Measurements are loaded so the delete also cascades on providers without database cascades (tests).
        db.TireChecks.Remove(await db.TireChecks.Include(c => c.Measurements)
                .FirstOrDefaultAsync(c => c.TireMountId == mount.Id && c.MeasuredAt == measuredAt, ct)
            ?? throw new NotFoundException(nameof(TireMeasurement), measuredAt));
        await db.SaveChangesAsync(ct);
    }

    public async Task<List<TireRotationDto>> ListRotationsAsync(Guid userId, Guid mountId, CancellationToken ct = default)
    {
        var mount = await FindMountAsync(userId, mountId, withVehicle: false, ct);
        return await Newest(db.TireRotations.Where(r => r.TireMountId == mount.Id))
            .Select(r => new TireRotationDto(r.Id, r.Date, r.OdometerKm, r.Notes)).ToListAsync(ct);
    }

    /// <summary>Logs a rotation of the mounted set; like mounts, it adds no odometer reading.</summary>
    public async Task<TireRotationDto> AddRotationAsync(Guid userId, Guid mountId, TireRotationRequest request, CancellationToken ct = default)
    {
        var mount = await FindOpenMountAsync(userId, mountId, ct);
        var (date, km) = Validate(request.Date, request.OdometerKm);
        RejectBeforeMount(mount, date);
        if (km < mount.MountOdometerKm)
        {
            throw OdometerBeforeMount(mount.MountOdometerKm);
        }

        var notes = Optional(request.Notes, TireRotation.MaxNotesLength, "tireRotation.invalidNotes", "Notes");

        // shortcut: two simultaneous rotations at 99 can both pass and make 101; harmless, add a lock if the limit ever matters.
        if (await db.TireRotations.CountAsync(r => r.TireMountId == mount.Id, ct) >= TireRotation.MaxPerMount)
        {
            throw new ValidationFailedException("tireRotation.limitReached", $"A mount can have up to {TireRotation.MaxPerMount} rotations.");
        }

        var rotation = new TireRotation { TireMountId = mount.Id, Date = date, OdometerKm = km, Notes = notes };
        db.TireRotations.Add(rotation);
        await db.SaveChangesAsync(ct);
        return new TireRotationDto(rotation.Id, rotation.Date, rotation.OdometerKm, rotation.Notes);
    }

    /// <summary>Allowed on a closed mount and an archived car.</summary>
    public async Task DeleteRotationAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        db.TireRotations.Remove(await db.TireRotations.FirstOrDefaultAsync(r => r.Id == id && r.TireMount!.TireSet!.UserId == userId, ct)
            ?? throw new NotFoundException(nameof(TireRotation), id));
        await db.SaveChangesAsync(ct);
    }

    // Scoped to the owner through the set, so another user's mount is simply not found. The car is joined only for the archived rule (L81).
    private async Task<TireMount> FindMountAsync(Guid userId, Guid id, bool withVehicle, CancellationToken ct) =>
        await (withVehicle ? db.TireMounts.Include(m => m.Vehicle) : db.TireMounts.AsQueryable())
            .FirstOrDefaultAsync(m => m.Id == id && m.TireSet!.UserId == userId, ct)
        ?? throw new NotFoundException(nameof(TireMount), id);

    // Checks and rotations are logged only for the set on an active car.
    private async Task<TireMount> FindOpenMountAsync(Guid userId, Guid id, CancellationToken ct)
    {
        var mount = await FindMountAsync(userId, id, withVehicle: true, ct);
        if (mount.Vehicle!.IsArchived)
        {
            throw new ValidationFailedException("tireMount.vehicleArchived", "This car is archived.");
        }

        return mount.UnmountedAt is null ? mount : throw new ValidationFailedException("tireMount.notOpen", "This set is no longer on the car.");
    }

    private static void RejectBeforeMount(TireMount mount, DateOnly date)
    {
        if (date < mount.MountedAt)
        {
            throw new ValidationFailedException("tireMount.dateBeforeMount", "The date is before the set was mounted.")
            {
                Extensions = { ["mountedAt"] = mount.MountedAt }
            };
        }
    }

    private static ValidationFailedException Item(string code, string message, int index) => new(code, message) { Extensions = { ["index"] = index } };

    private static ConflictException DuplicateCheck(DateOnly date) =>
        new("tireMeasurement.duplicate", "There is already a check on this date. Delete it to log it again.") { Extensions = { ["measuredAt"] = date } };

    private static ValidationFailedException OdometerBeforeMount(decimal mountOdometerKm) =>
        new("tireMount.odometerBeforeMount", "The odometer is below the odometer at mount.") { Extensions = { ["mountOdometerKm"] = mountOdometerKm } };

    // Newest first: by date, then odometer.
    private static IQueryable<TireRotation> Newest(IQueryable<TireRotation> rotations) =>
        rotations.OrderByDescending(r => r.Date).ThenByDescending(r => r.OdometerKm);

    // The newest `count` checks of the mount, wheels in FL, FR, RL, RR, Spare order.
    private async Task<List<TireCheckDto>> ChecksAsync(Guid mountId, int count, CancellationToken ct) =>
        await db.TireChecks.Where(c => c.TireMountId == mountId).OrderByDescending(c => c.MeasuredAt).Take(count)
            .Select(c => new TireCheckDto(c.MeasuredAt, c.Measurements.OrderBy(m => m.Position)
                .Select(m => new TireCheckItemDto(m.Position, m.PressureBar, m.TreadDepthMm)).ToList()))
            .ToListAsync(ct);

    private static ValidationFailedException Overlap() =>
        new("tireMount.overlap", "The date overlaps an earlier mount of this set or car.");

    private static void Close(TireMount open, DateOnly date, decimal km)
    {
        if (km < open.MountOdometerKm)
        {
            throw OdometerBeforeMount(open.MountOdometerKm);
        }

        (open.UnmountedAt, open.UnmountOdometerKm, open.UpdatedAt) = (date, km, DateTimeOffset.UtcNow);
    }

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
        return d > today.AddDays(1) ? throw new ValidationFailedException("tireMount.futureDate", "The date can't be in the future.") : d;
    }

    private static void Apply(TireSet set, TireSetRequest r)
    {
        var brand = r.Brand?.Trim() ?? "";
        if (brand.Length is 0 or > TireSet.MaxBrandLength)
        {
            throw new ValidationFailedException("tireSet.invalidBrand", $"The brand must be 1 to {TireSet.MaxBrandLength} characters.");
        }

        var model = Optional(r.Model, TireSet.MaxModelLength, "tireSet.invalidModel", "The model");
        var size = Optional(r.Size, TireSet.MaxSizeLength, "tireSet.invalidSize", "The size");
        var dotCode = Optional(r.DotCode, TireSet.MaxDotCodeLength, "tireSet.invalidDotCode", "The DOT code");
        var notes = Optional(r.Notes, TireSet.MaxNotesLength, "tireSet.invalidNotes", "Notes");
        if (r.Season is not { } season)
        {
            throw new ValidationFailedException("tireSet.invalidSeason", "Pick a season.");
        }

        if (r.PurchaseDate is { } purchased)
        {
            DateRules.RejectTooEarly(purchased);
            if (purchased > DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1))
            {
                throw new ValidationFailedException("tireSet.futureDate", "The purchase date can't be in the future.");
            }
        }

        (set.Brand, set.Model, set.Size, set.Season, set.PurchaseDate, set.DotCode, set.Notes) =
            (brand, model, size, season, r.PurchaseDate, dotCode, notes);
    }

    // Trimmed; blank is null.
    private static string? Optional(string? value, int max, string code, string field)
    {
        var v = value?.Trim() is { Length: > 0 } s ? s : null;
        return v?.Length > max ? throw new ValidationFailedException(code, $"{field} can be up to {max} characters.") : v;
    }

    // Scoped to the owner, so another user's set is simply not found.
    private async Task<TireSet> FindSetAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.TireSets.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId, ct)
        ?? throw new NotFoundException(nameof(TireSet), id);

    private async Task<TireSetDto> SetDtoAsync(Guid id, CancellationToken ct) => await Project(db.TireSets.Where(s => s.Id == id)).SingleAsync(ct);

    private async Task<VehicleTiresDto> VehicleTiresAsync(Guid vehicleId, CancellationToken ct)
    {
        var mounts = db.TireMounts.Where(m => m.VehicleId == vehicleId);
        var current = await ProjectMounts(mounts.Where(m => m.UnmountedAt == null)).FirstOrDefaultAsync(ct);
        var past = await ProjectMounts(mounts.Where(m => m.UnmountedAt != null)).Take(MaxPastMountsListed).ToListAsync(ct);
        if (current is not null)
        {
            var lastCheck = (await ChecksAsync(current.Id, 1, ct)).FirstOrDefault();
            var lastRotation = await Newest(db.TireRotations.Where(r => r.TireMountId == current.Id))
                .Select(r => new LastTireRotationDto(r.Date, r.OdometerKm, r.TireMount!.Vehicle!.CurrentOdometerKm > r.OdometerKm
                    ? r.TireMount.Vehicle.CurrentOdometerKm - r.OdometerKm
                    : 0))
                .FirstOrDefaultAsync(ct);
            current = current with { LastCheck = lastCheck, LastRotation = lastRotation };
        }

        return new VehicleTiresDto(current, past);
    }

    // The km formula appears twice (here and ProjectMounts) because EF can't call a shared expression inside a projection.
    private static IQueryable<TireSetDto> Project(IQueryable<TireSet> sets) =>
        sets.Select(s => new TireSetDto(s.Id, s.Brand, s.Model, s.Size, s.Season, s.PurchaseDate, s.DotCode, s.Notes, s.CreatedAt,
            s.Mounts.Sum(m => m.UnmountOdometerKm != null
                ? m.UnmountOdometerKm.Value - m.MountOdometerKm
                : m.Vehicle!.CurrentOdometerKm > m.MountOdometerKm ? m.Vehicle.CurrentOdometerKm - m.MountOdometerKm : 0),
            s.Mounts.Where(m => m.UnmountedAt == null)
                .Select(m => new TireSetOpenMountDto(m.VehicleId, m.Vehicle!.Nickname, m.MountedAt, m.MountOdometerKm))
                .FirstOrDefault(),
            s.Mounts.Count));

    // Newest first; on the same date, the later-created (the swap's new mount) first.
    private static IQueryable<TireMountDto> ProjectMounts(IQueryable<TireMount> mounts) =>
        mounts.OrderByDescending(m => m.MountedAt).ThenByDescending(m => m.CreatedAt)
            .Select(m => new TireMountDto(m.Id, m.TireSetId, m.TireSet!.Brand, m.TireSet.Model, m.TireSet.Size, m.TireSet.Season,
                m.VehicleId, m.Vehicle!.Nickname, m.MountedAt, m.MountOdometerKm, m.UnmountedAt, m.UnmountOdometerKm,
                m.UnmountOdometerKm != null
                    ? m.UnmountOdometerKm.Value - m.MountOdometerKm
                    : m.Vehicle.CurrentOdometerKm > m.MountOdometerKm ? m.Vehicle.CurrentOdometerKm - m.MountOdometerKm : 0));
}
