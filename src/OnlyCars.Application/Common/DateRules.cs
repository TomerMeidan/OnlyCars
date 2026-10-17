using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Application.Common;

/// <summary>Shared lower bound for run, service record, odometer reading, tire, to-do done and task last-done dates (L50, L67).</summary>
public static class DateRules
{
    public static readonly DateOnly Earliest = new(1900, 1, 1);

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
}
