using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

public class User : Entity
{
    public required string Email { get; set; }
    // Empty for an account made with Google: no password then matches it.
    public required string PasswordHash { get; set; }
    // Google's stable account id ("sub"), once the user has signed in with Google.
    public string? GoogleSubject { get; set; }
    public DistanceUnit DistanceUnit { get; set; } = DistanceUnit.Km;
    public string Currency { get; set; } = "ILS";
    public Locale Locale { get; set; } = Locale.En;
    public Theme Theme { get; set; } = Theme.System;

    public ICollection<Vehicle> Vehicles { get; set; } = new List<Vehicle>();
}
