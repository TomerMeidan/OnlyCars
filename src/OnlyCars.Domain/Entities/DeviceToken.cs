using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>
/// A long-lived credential for a device that only adds odometer readings, such as the OBD adapter app (OBD-1).
/// Only the token's hash is stored; revoking it deletes the row.
/// </summary>
public class DeviceToken : Entity
{
    public Guid UserId { get; set; }
    public User? User { get; set; }

    public required string Name { get; set; }
    /// <summary>SHA-256 of the token, in hex. The token itself is shown once, when it is made.</summary>
    public required string TokenHash { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
}
