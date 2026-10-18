using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Maintenance;

/// <summary>Receipt files of service records (FILE-2, decisions.md "Attachments, FILE-2"), through the shared <see cref="AttachmentFiles"/>.</summary>
public partial class MaintenanceTaskService
{
    /// <summary>
    /// Stores the file (images without metadata, PDFs as sent) under the record's prefix, then adds the row; if the row can't
    /// be saved (a concurrency conflict included) the object is deleted. Checks in the order of the FILE-2 contract. Returns the record with its attachments.
    /// </summary>
    public async Task<ServiceRecordDto> AddAttachmentAsync(Guid userId, Guid vehicleId, Guid recordId, byte[]? content, string? fileName,
        CancellationToken ct = default)
    {
        vehicleService.Storage();
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var record = await db.ServiceRecords
            .Include(r => r.Tasks).ThenInclude(j => j.MaintenanceTask)
            .Include(r => r.Items)
            .Include(r => r.Attachments)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == recordId && r.VehicleId == vehicle.Id && !r.IsVoided, ct)
            ?? throw new NotFoundException(nameof(ServiceRecord), recordId);

        await attachmentFiles.AddAsync(userId, vehicle, record, record.Attachments, AttachmentFiles.ServiceRecordPrefix(userId, vehicle.Id, record.Id),
            content, fileName, photosOnly: false, ct);
        return ToDto(record, userId);
    }

    /// <summary>Deletes the row, then the object (a failed object delete is logged). Allowed on an archived car.</summary>
    public async Task DeleteAttachmentAsync(Guid userId, Guid vehicleId, Guid recordId, Guid attachmentId, CancellationToken ct = default)
    {
        vehicleService.Storage();
        // One scoped lookup: another user's car or record, or a mismatched path, is the same 404.
        var attachment = await db.Attachments.FirstOrDefaultAsync(a => a.Id == attachmentId && a.ServiceRecordId == recordId
                             && a.ServiceRecord!.VehicleId == vehicleId && a.ServiceRecord.Vehicle!.UserId == userId, ct)
                         ?? throw new NotFoundException(nameof(Attachment), attachmentId);

        db.Attachments.Remove(attachment);
        await db.SaveChangesAsync(ct);
        await attachmentFiles.DeleteObjectsAsync([attachment], AttachmentFiles.ServiceRecordPrefix(userId, vehicleId, recordId));
    }
}
