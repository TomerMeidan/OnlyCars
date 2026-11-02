using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OnlyCars.Api.Controllers;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Issues;
using OnlyCars.Application.Issues.Dtos;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Reminders;
using OnlyCars.Application.Reminders.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>NOT-2: the daily reminder email.</summary>
public class EmailDigestTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly string dbName = Guid.NewGuid().ToString();
    private readonly AppDbContext db;
    private readonly FakeEmailSender sender = new();
    private readonly VehicleService vehicles;

    public EmailDigestTests()
    {
        db = NewContext();
        vehicles = new VehicleService(db);
    }

    private AppDbContext NewContext() => new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(dbName).Options);

    private DigestService Digest(AppDbContext? context = null, IEmailSender? emailSender = null)
    {
        var c = context ?? db;
        return new DigestService(c, new ReminderService(c), Options.Create(new EmailOptions { SiteUrl = "https://cars.test/" }),
            NullLogger<DigestService>.Instance, emailSender ?? sender);
    }

    private async Task<User> UserAsync(string email, Locale locale = Locale.En, DistanceUnit unit = DistanceUnit.Km)
    {
        var user = new User { Email = email, PasswordHash = "", Locale = locale, DistanceUnit = unit };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    // Starts at 50,000 km.
    private async Task<Guid> CarAsync(Guid owner, string nickname = "Mazda") =>
        (await vehicles.CreateAsync(owner, new CreateVehicleRequest(nickname, null, null, null, null, null, null, null, null, null, 50_000))).Id;

    // 5,000 km interval: Due soon from 4,500 km used, Overdue past 5,000.
    private Task<MaintenanceTaskDto> TaskAsync(Guid owner, Guid car, string name, decimal usedKm) =>
        new MaintenanceTaskService(db, vehicles).CreateAsync(owner, car,
            new CreateMaintenanceTaskRequest(null, name, "Oil", 5_000, null, 50_000 - usedKm, Today));

    private Task<IssueDto> ToDoAsync(Guid owner, Guid car, string title) =>
        new IssueService(db, vehicles).CreateAsync(owner, car, new CreateIssueRequest(title, null, null));

    private AuthService Auth() => new(db, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
        Options.Create(new RateLimitOptions()));

    [Fact]
    public async Task Run_SendsOnlyDueItemsAndOpenToDos_AndNothingToAUserWithNothingDue()
    {
        var me = await UserAsync("me@cars.test");
        var car = await CarAsync(me.Id);
        await TaskAsync(me.Id, car, "Oil change", 5_300);
        await TaskAsync(me.Id, car, "Air filter", 100); // OK
        await ToDoAsync(me.Id, car, "Fix the mirror");
        var idle = await UserAsync("idle@cars.test");
        await TaskAsync(idle.Id, await CarAsync(idle.Id), "Brakes", 100);
        var other = await UserAsync("other@cars.test");
        await TaskAsync(other.Id, await CarAsync(other.Id, "Other car"), "Other task", 5_300);

        Assert.Equal(2, await Digest().RunAsync(Today));

        var mail = Assert.Single(sender.Sent, m => m.To == "me@cars.test");
        Assert.Equal("OnlyCars: 2 items need attention", mail.Subject);
        Assert.Contains("<b>Oil change</b>: Overdue by 300 km", mail.Html);
        Assert.Contains("To-do: Fix the mirror", mail.Html);
        Assert.DoesNotContain("Air filter", mail.Html);
        Assert.DoesNotContain("Other", mail.Html);
        Assert.Contains("href=\"https://cars.test/settings\"", mail.Html);
        Assert.DoesNotContain(sender.Sent, m => m.To == "idle@cars.test");
    }

    [Fact]
    public async Task OptOut_IsSavedInSettings_AndRespected()
    {
        var me = await UserAsync("me@cars.test");
        await ToDoAsync(me.Id, await CarAsync(me.Id), "Wash");
        Assert.True((await Auth().GetMeAsync(me.Id)).EmailReminders); // on by default

        var off = await Auth().UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(EmailReminders: false));
        Assert.False(off.EmailReminders);
        Assert.False((await Auth().UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(Theme: "Dark"))).EmailReminders); // null leaves it
        Assert.Equal(0, await Digest().RunAsync(Today));

        await Auth().UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(EmailReminders: true));
        Assert.Equal(1, await Digest().RunAsync(Today));
    }

    [Fact]
    public async Task Run_SendsOncePerDay_EvenWhenTimerAndEndpointRunTogether()
    {
        var me = await UserAsync("me@cars.test");
        await ToDoAsync(me.Id, await CarAsync(me.Id), "Wash");

        // Two scopes at once, as the timer and the job endpoint would be.
        await using var a = NewContext();
        await using var b = NewContext();
        await Task.WhenAll(Digest(a).RunAsync(Today), Digest(b).RunAsync(Today));
        Assert.Equal(0, await Digest().RunAsync(Today));
        Assert.Single(sender.Sent);

        Assert.Equal(1, await Digest().RunAsync(Today.AddDays(1)));
        Assert.Equal(2, sender.Sent.Count);
    }

    [Fact]
    public async Task OneFailingUser_DoesNotStopTheOthers_AndIsRetriedNextRun()
    {
        foreach (var email in new[] { "a@cars.test", "fail@cars.test", "c@cars.test" })
        {
            var user = await UserAsync(email);
            await ToDoAsync(user.Id, await CarAsync(user.Id), "Wash");
        }

        sender.FailFor = "fail@cars.test";
        Assert.Equal(2, await Digest().RunAsync(Today));
        Assert.DoesNotContain(sender.Sent, m => m.To == "fail@cars.test");

        sender.FailFor = null;
        Assert.Equal(1, await Digest().RunAsync(Today));
        Assert.Contains(sender.Sent, m => m.To == "fail@cars.test");
    }

    [Fact]
    public async Task Run_WithoutASender_SendsNothing()
    {
        var me = await UserAsync("me@cars.test");
        await ToDoAsync(me.Id, await CarAsync(me.Id), "Wash");

        var digest = new DigestService(db, new ReminderService(db), Options.Create(new EmailOptions()), NullLogger<DigestService>.Instance);

        Assert.Equal(0, await digest.RunAsync(Today));
        Assert.Empty(db.NotificationRules);
    }

    [Fact]
    public async Task UserText_IsHtmlEncoded()
    {
        var me = await UserAsync("me@cars.test");
        var car = await CarAsync(me.Id, "<script>alert(1)</script>");
        await TaskAsync(me.Id, car, "Oil & <b>filter</b>", 5_300);
        await ToDoAsync(me.Id, car, "<img src=x onerror=alert(1)>");

        await Digest().RunAsync(Today);

        var html = Assert.Single(sender.Sent).Html;
        Assert.DoesNotContain("<script>", html);
        Assert.DoesNotContain("<img", html);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;", html);
        Assert.Contains("Oil &amp; &lt;b&gt;filter&lt;/b&gt;", html);
    }

    [Fact]
    public async Task Hebrew_IsRightToLeftInHebrew_WithTheUsersDistanceUnit()
    {
        var he = await UserAsync("he@cars.test", Locale.He, DistanceUnit.Mi);
        var car = await CarAsync(he.Id);
        await TaskAsync(he.Id, car, "Oil change", 5_000 + 1_609.344m); // a mile per 1.609344 km
        await ToDoAsync(he.Id, car, "Wash");

        await Digest().RunAsync(Today);

        var mail = Assert.Single(sender.Sent);
        Assert.Equal("OnlyCars: 2 פריטים דורשים תשומת לב", mail.Subject);
        Assert.Contains("<html lang=\"he\" dir=\"rtl\">", mail.Html);
        Assert.Contains("באיחור של 1,000 מייל", mail.Html);
        Assert.Contains("מטלה: Wash", mail.Html);
        Assert.Contains("הגדרות", mail.Html);
    }

    [Theory]
    [InlineData(Locale.En, 0, "Expires today")]
    [InlineData(Locale.En, 5, "Expires in 5 days")]
    [InlineData(Locale.En, -1, "Expired 1 day ago")]
    [InlineData(Locale.He, 2, "התוקף יפוג בעוד יומיים")]
    [InlineData(Locale.He, -10, "התוקף פג לפני 10 ימים")]
    public void Render_Documents(Locale locale, int daysLeft, string expected)
    {
        var item = new ReminderDto(NotificationKind.Document, Guid.NewGuid(), Guid.NewGuid(), "Mazda", null, VehicleDocumentType.Insurance,
            "Expiring", Today.AddDays(daysLeft), null, daysLeft);

        var (_, html) = DigestEmail.Render(new RemindersDto(30, 0, [item], []), locale, DistanceUnit.Km, null);

        Assert.Contains(expected, html);
        Assert.DoesNotContain("href", html); // no site link without Email:SiteUrl
    }

    [Theory]
    [InlineData(Locale.En, 300, 12, "300 km or 12 days left")]
    [InlineData(Locale.En, -300, -1, "Overdue by 300 km and 1 day")]
    [InlineData(Locale.En, 300, 0, "Due today")]
    [InlineData(Locale.He, 1200, 40, "עוד 1,200 ק״מ או 40 ימים")]
    [InlineData(Locale.He, 50, -1, "באיחור של יום")]
    public void Render_Tasks(Locale locale, int km, int days, string expected)
    {
        var item = new ReminderDto(NotificationKind.Task, Guid.NewGuid(), Guid.NewGuid(), "Mazda", "Oil", null, "DueSoon", null, km, days);

        var (_, html) = DigestEmail.Render(new RemindersDto(30, 0, [item], []), locale, DistanceUnit.Km, null);

        Assert.Contains(expected, html);
    }

    [Fact]
    public async Task JobEndpoint_Is404WithoutAKey_401ForAMissingOrWrongKey_AndRunsWithTheRightOne()
    {
        var me = await UserAsync("me@cars.test");
        await ToDoAsync(me.Id, await CarAsync(me.Id), "Wash");
        JobsController Jobs(string? jobKey) => new(Digest(), Options.Create(new EmailOptions { JobKey = jobKey }));

        Assert.IsType<NotFoundResult>(await Jobs(null).DailyDigest("anything"));
        Assert.IsType<NotFoundResult>(await Jobs("").DailyDigest(""));
        Assert.Equal("job.invalidKey", (await Assert.ThrowsAsync<UnauthorizedException>(() => Jobs("secret-key").DailyDigest(null))).Code);
        await Assert.ThrowsAsync<UnauthorizedException>(() => Jobs("secret-key").DailyDigest("secret-kez"));
        Assert.Empty(sender.Sent);

        Assert.IsType<NoContentResult>(await Jobs("secret-key").DailyDigest("secret-key"));
        Assert.Single(sender.Sent);
    }

    private sealed class FakeEmailSender : IEmailSender
    {
        public List<(string To, string Subject, string Html)> Sent { get; } = [];
        public string? FailFor { get; set; }

        public async Task SendAsync(string to, string subject, string html, CancellationToken ct = default)
        {
            await Task.Delay(10, ct); // lets two runs overlap
            if (to == FailFor)
            {
                throw new HttpRequestException("Resend returned 500.", null, System.Net.HttpStatusCode.InternalServerError);
            }

            lock (Sent)
            {
                Sent.Add((to, subject, html));
            }
        }
    }
}
