namespace OnlyCars.Domain;

public enum DistanceUnit
{
    Km,
    Mi
}

public enum Locale
{
    En,
    He
}

public enum Theme
{
    Light,
    Dark,
    System
}

public enum FuelType
{
    Petrol,
    Diesel,
    Hybrid,
    Electric,
    Lpg,
    Other
}

public enum OdometerSource
{
    Manual,
    Service,
    Checklist,
    Fuel
}

public enum TaskCategory
{
    Oil,
    Filters,
    Brakes,
    Tires,
    Fluids,
    Battery,
    Belts,
    Ignition,
    Other
}

// Computed on read, never stored. Ordered by severity so the worse of two is the larger value.
public enum DueStatus
{
    Ok,
    DueSoon,
    Overdue
}

public enum ChecklistItemType
{
    Check,
    Number,
    Text
}

public enum IssueStatus
{
    Open,
    Done
}

public enum TireSeason
{
    Summer,
    Winter,
    AllSeason
}
