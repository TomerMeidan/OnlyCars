using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Issues.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Issues;

/// <summary>A car's to-dos (MVP5-C, decisions.md "Flagged checklist items, MVP5-C").</summary>
public class IssueService(IAppDbContext db, VehicleService vehicleService)
{
    private static readonly DateOnly MinDate = new(2000, 1, 1);

    /// <summary>Open first (newest created first), then done (newest resolved first, then newest created).</summary>
    public async Task<List<IssueDto>> ListAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        return await Project(db.Issues.Where(i => i.VehicleId == vehicleId)
            .OrderBy(i => i.Status).ThenByDescending(i => i.ResolvedAt).ThenByDescending(i => i.CreatedAt))
            .ToListAsync(ct);
    }

    public async Task<IssueDto> CreateAsync(Guid userId, Guid vehicleId, CreateIssueRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        if (vehicle.IsArchived)
        {
            throw new ValidationFailedException("issue.vehicleArchived", "This car is archived.");
        }

        var (title, description) = Validate(request.Title, request.Description);

        if (request.SourceRunItemId is { } sourceId)
        {
            var source = await db.ChecklistRunItems
                .Where(i => i.Id == sourceId && i.Run!.VehicleChecklist!.Vehicle!.UserId == userId)
                .Select(i => new { i.IsFlagged, i.Run!.VehicleChecklist!.VehicleId })
                .FirstOrDefaultAsync(ct)
                ?? throw new NotFoundException(nameof(ChecklistRunItem), sourceId);
            if (!source.IsFlagged || source.VehicleId != vehicle.Id)
            {
                throw new ValidationFailedException("issue.invalidSource", "This item isn't a flagged item of this car's checklist runs.");
            }

            if (await db.Issues.AnyAsync(i => i.SourceRunItemId == sourceId, ct))
            {
                throw Duplicate();
            }
        }

        // shortcut: two simultaneous creates at 499 can both pass and make 501; harmless, add a lock if the limit ever matters.
        if (await db.Issues.CountAsync(i => i.VehicleId == vehicle.Id, ct) >= Issue.MaxPerVehicle)
        {
            throw new ValidationFailedException("issue.limitReached", $"A car can have up to {Issue.MaxPerVehicle} to-dos.");
        }

        var issue = new Issue { VehicleId = vehicle.Id, Title = title, Description = description, SourceRunItemId = request.SourceRunItemId };
        db.Issues.Add(issue);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (request.SourceRunItemId is not null)
        {
            // A simultaneous create of the same run item won the unique index.
            if (await db.Issues.AnyAsync(i => i.SourceRunItemId == request.SourceRunItemId && i.Id != issue.Id, ct))
            {
                throw Duplicate();
            }

            throw;
        }

        return await DtoAsync(issue.Id, ct);
    }

    public async Task<IssueDto> UpdateAsync(Guid userId, Guid id, UpdateIssueRequest request, CancellationToken ct = default)
    {
        var issue = await FindOwnedAsync(userId, id, ct);
        var (title, description) = Validate(request.Title, request.Description);

        var status = request.Status ?? issue.Status;
        DateOnly? resolvedAt = null;
        if (status == IssueStatus.Done)
        {
            if (request.ResolvedAt is not { } date || date < MinDate)
            {
                throw new ValidationFailedException("issue.invalidDate", "A done to-do needs a date from 2000-01-01.");
            }

            // The client sends its local date: one day of slack, as for vehicleChecklist.invalidDate.
            if (date > DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1))
            {
                throw new ValidationFailedException("issue.futureDate", "The done date can't be in the future.");
            }

            resolvedAt = date;
        }

        (issue.Title, issue.Description, issue.Status, issue.ResolvedAt) = (title, description, status, resolvedAt);
        issue.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await DtoAsync(issue.Id, ct);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        db.Issues.Remove(await FindOwnedAsync(userId, id, ct));
        await db.SaveChangesAsync(ct);
    }

    private static ConflictException Duplicate() => new("issue.duplicate", "This item already has a to-do.");

    private static (string Title, string? Description) Validate(string? title, string? description)
    {
        var t = title?.Trim() ?? "";
        if (t.Length is 0 or > Issue.MaxTitleLength)
        {
            throw new ValidationFailedException("issue.invalidTitle", $"The title must be 1 to {Issue.MaxTitleLength} characters.");
        }

        var d = description?.Trim() is { Length: > 0 } s ? s : null;
        if (d?.Length > Issue.MaxDescriptionLength)
        {
            throw new ValidationFailedException("issue.invalidDescription", $"The description can be up to {Issue.MaxDescriptionLength} characters.");
        }

        return (t, d);
    }

    // Scoped through the car's owner, so another user's to-do is simply not found.
    private async Task<Issue> FindOwnedAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.Issues.FirstOrDefaultAsync(i => i.Id == id && i.Vehicle!.UserId == userId, ct)
        ?? throw new NotFoundException(nameof(Issue), id);

    private async Task<IssueDto> DtoAsync(Guid id, CancellationToken ct) => await Project(db.Issues.Where(i => i.Id == id)).SingleAsync(ct);

    private static IQueryable<IssueDto> Project(IQueryable<Issue> issues) =>
        issues.Select(i => new IssueDto(i.Id, i.VehicleId, i.Title, i.Description, i.Status, i.ResolvedAt, i.CreatedAt,
            i.SourceRunItem == null
                ? null
                : new IssueSourceDto(i.SourceRunItem.Id, i.SourceRunItem.RunId, i.SourceRunItem.Run!.RunAt,
                    i.SourceRunItem.Run.VehicleChecklist!.Template!.Name, i.SourceRunItem.LabelSnapshot)));
}
