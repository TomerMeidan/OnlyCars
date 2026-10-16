using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
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
        var mount = await db.TireMounts.FirstOrDefaultAsync(m => m.Id == id && m.TireSet!.UserId == userId, ct)
            ?? throw new NotFoundException(nameof(TireMount), id);
        db.TireMounts.Remove(mount);
        await db.SaveChangesAsync(ct);
    }

    private static ValidationFailedException Overlap() =>
        new("tireMount.overlap", "The date overlaps an earlier mount of this set or car.");

    private static void Close(TireMount open, DateOnly date, decimal km)
    {
        if (km < open.MountOdometerKm)
        {
            throw new ValidationFailedException("tireMount.odometerBeforeMount", "The odometer is below the odometer at mount.")
            {
                Extensions = { ["mountOdometerKm"] = open.MountOdometerKm }
            };
        }

        (open.UnmountedAt, open.UnmountOdometerKm, open.UpdatedAt) = (date, km, DateTimeOffset.UtcNow);
    }

    private static (DateOnly Date, decimal Km) Validate(DateOnly? date, decimal? odometerKm)
    {
        // Same one day of slack as readings: the client sends its local date.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var d = date ?? today;
        DateRules.RejectTooEarly(d);
        if (d > today.AddDays(1))
        {
            throw new ValidationFailedException("tireMount.futureDate", "The date can't be in the future.");
        }

        if (odometerKm is not { } km || km is < 0 or > OdometerReading.MaxValueKm)
        {
            throw new ValidationFailedException("odometer.invalidValue", $"The odometer must be between 0 and {OdometerReading.MaxValueKm} km.");
        }

        return (d, km);
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
