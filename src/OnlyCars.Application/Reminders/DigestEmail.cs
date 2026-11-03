using System.Globalization;
using System.Net;
using System.Text;
using OnlyCars.Application.Reminders.Dtos;
using OnlyCars.Domain;

namespace OnlyCars.Application.Reminders;

/// <summary>The digest's subject and simple HTML body, in the user's language and distance unit, grouped by car (NOT-2).</summary>
public static class DigestEmail
{
    private const decimal KmPerMile = 1.609344m;

    public static (string Subject, string Html) Render(RemindersDto due, Locale locale, DistanceUnit unit, string? siteUrl)
    {
        var he = locale == Locale.He;
        var culture = CultureInfo.GetCultureInfo(he ? "he-IL" : "en-US");
        var count = due.Items.Count + due.OpenToDos.Count;
        var subject = he
            ? count == 1 ? "OnlyCars: פריט אחד דורש תשומת לב" : $"OnlyCars: {count} פריטים דורשים תשומת לב"
            : count == 1 ? "OnlyCars: 1 item needs attention" : $"OnlyCars: {count} items need attention";

        var html = new StringBuilder();
        html.Append(he ? "<!DOCTYPE html><html lang=\"he\" dir=\"rtl\">" : "<!DOCTYPE html><html lang=\"en\" dir=\"ltr\">")
            .Append("<body style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222\">")
            // Gmail drops the html element's dir, so the content's own wrapper carries it too (owner, 2026-11-03).
            .Append(he ? "<div dir=\"rtl\" style=\"direction:rtl;text-align:right\">" : "<div dir=\"ltr\">")
            .Append("<h1 style=\"font-size:20px\">").Append(he ? "דורש תשומת לב" : "Needs attention").Append("</h1>");

        // Cars in the order of their most urgent item, then cars with to-dos only.
        var cars = due.Items.Select(i => (i.VehicleId, i.VehicleNickname)).Concat(due.OpenToDos.Select(t => (t.VehicleId, t.VehicleNickname))).Distinct();
        foreach (var (carId, nickname) in cars)
        {
            html.Append("<h2 style=\"font-size:17px;margin-bottom:4px\">").Append(Encode(nickname)).Append("</h2><ul>");
            foreach (var item in due.Items.Where(i => i.VehicleId == carId))
            {
                var name = item.DocumentType is { } type ? DocumentName(type, he) : item.Name ?? "";
                html.Append("<li><b>").Append(Encode(name)).Append("</b>: ").Append(Encode(DueText(item, he, unit, culture))).Append("</li>");
            }

            foreach (var toDo in due.OpenToDos.Where(t => t.VehicleId == carId))
            {
                html.Append("<li>").Append(he ? "מטלה: " : "To-do: ").Append(Encode(toDo.Title)).Append("</li>");
            }

            html.Append("</ul>");
        }

        if (siteUrl is { Length: > 0 })
        {
            var site = siteUrl.TrimEnd('/');
            html.Append("<p><a href=\"").Append(Encode(site)).Append("\">").Append(he ? "פתיחת OnlyCars" : "Open OnlyCars").Append("</a></p>")
                .Append("<p style=\"color:#666;font-size:12px\">")
                .Append(he ? "קיבלת את המייל הזה כי תזכורות במייל מופעלות. אפשר לכבות אותן ב" : "You get this email because email reminders are on. You can turn them off in ")
                .Append("<a href=\"").Append(Encode(site + "/settings")).Append("\">").Append(he ? "הגדרות" : "Settings").Append("</a>.</p>");
        }

        return (subject, html.Append("</div></body></html>").ToString());
    }

    private static string Encode(string text) => WebUtility.HtmlEncode(text);

    private static string DocumentName(VehicleDocumentType type, bool he) => type switch
    {
        VehicleDocumentType.Insurance => he ? "ביטוח" : "Insurance",
        VehicleDocumentType.Inspection => he ? "טסט" : "Inspection",
        VehicleDocumentType.Registration => he ? "רישיון רכב" : "Registration",
        _ => he ? "רישיון נהיגה" : "Driver's license"
    };

    // The client's wording: "300 km or 12 days left", "Overdue by 300 km and 12 days", "Expires in 5 days".
    private static string DueText(ReminderDto item, bool he, DistanceUnit unit, CultureInfo culture)
    {
        var days = item.RemainingDays;
        if (item.Kind == NotificationKind.Document)
        {
            return days switch
            {
                0 => he ? "התוקף פג היום" : "Expires today",
                < 0 => he ? $"התוקף פג לפני {Days(-days.Value, he, culture)}" : $"Expired {Days(-days.Value, he, culture)} ago",
                _ => he ? $"התוקף יפוג בעוד {Days(days ?? 0, he, culture)}" : $"Expires in {Days(days ?? 0, he, culture)}"
            };
        }

        var km = item.RemainingKm is { } k ? (unit == DistanceUnit.Mi ? k / KmPerMile : k) : (decimal?)null;
        var distance = he ? (unit == DistanceUnit.Mi ? "מייל" : "ק״מ") : (unit == DistanceUnit.Mi ? "mi" : "km");
        string Distance(decimal value) => $"{Math.Round(value, MidpointRounding.AwayFromZero).ToString("N0", culture)} {distance}";

        var late = new[] { km < 0 ? Distance(-km.GetValueOrDefault()) : null, days < 0 ? Days(-days.GetValueOrDefault(), he, culture) : null }.OfType<string>().ToList();
        if (late.Count > 0)
        {
            return (he ? "באיחור של " : "Overdue by ") + string.Join(he ? " וגם " : " and ", late);
        }

        if (days == 0)
        {
            return he ? "היום" : "Due today";
        }

        var left = new[] { km is { } kmLeft ? Distance(kmLeft) : null, days is { } daysLeft ? Days(daysLeft, he, culture) : null }.OfType<string>();
        var parts = string.Join(he ? " או " : " or ", left);
        return he ? $"עוד {parts}" : $"{parts} left";
    }

    private static string Days(int n, bool he, CultureInfo culture) => (n, he) switch
    {
        (1, true) => "יום",
        (2, true) => "יומיים",
        (_, true) => $"{n.ToString("N0", culture)} ימים",
        (1, false) => "1 day",
        _ => $"{n.ToString("N0", culture)} days"
    };
}
