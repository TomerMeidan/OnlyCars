using OnlyCars.Domain;

namespace OnlyCars.Application.Issues.Dtos;

// The flagged run item a to-do came from: its run, the run date, the checklist's current name and the item's label at run time.
public record IssueSourceDto(Guid RunItemId, Guid RunId, DateOnly RunAt, string ChecklistName, string Label);

// Source is null for a to-do added by hand or once its run was deleted.
public record IssueDto(Guid Id, Guid VehicleId, string Title, string? Description, IssueStatus Status, DateOnly? ResolvedAt,
    DateTimeOffset CreatedAt, IssueSourceDto? Source);

public record CreateIssueRequest(string? Title, string? Description, Guid? SourceRunItemId);

// A null Status keeps the current one. Done needs ResolvedAt (the client's local date); Open clears it.
public record UpdateIssueRequest(string? Title, string? Description, IssueStatus? Status, DateOnly? ResolvedAt);
