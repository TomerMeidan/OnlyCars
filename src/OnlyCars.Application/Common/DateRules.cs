using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Application.Common;

/// <summary>Shared lower bound for run, service record, odometer reading, tire, to-do done and task last-done dates (L50, L67).</summary>
public static class DateRules
{
    public static readonly DateOnly Earliest = new(1900, 1, 1);
    public static readonly DateOnly Latest = new(2100, 12, 31);

    public static void RejectTooEarly(DateOnly date)
    {
        if (date < Earliest)
        {
            throw new ValidationFailedException("date.tooEarly", "The date can't be before 1900-01-01.")
            {
                Extensions = { ["minDate"] = Earliest }
            };
        }
    }

    // Only future dates allowed (document expiry) need it.
    public static void RejectTooLate(DateOnly date)
    {
        if (date > Latest)
        {
            throw new ValidationFailedException("date.tooLate", "The date can't be after 2100-12-31.")
            {
                Extensions = { ["maxDate"] = Latest }
            };
        }
    }

    /// <summary>The client's local date (default the server's UTC date), at most one day from the UTC date, as on the dashboard.</summary>
    public static DateOnly ClientToday(DateOnly? today, string code)
    {
        var utcToday = DateOnly.FromDateTime(DateTime.UtcNow);
        var local = today ?? utcToday;
        if (Math.Abs(local.DayNumber - utcToday.DayNumber) > 1)
        {
            throw new ValidationFailedException(code, "The date must be today.");
        }

        return local;
    }
}
