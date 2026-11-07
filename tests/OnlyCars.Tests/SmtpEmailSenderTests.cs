using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OnlyCars.Application.Common;
using OnlyCars.Infrastructure;
using OnlyCars.Infrastructure.Email;

namespace OnlyCars.Tests;

/// <summary>NOT-2 through Gmail (owner, 2026-11-02): which sender the settings pick, and the message it sends.</summary>
public class SmtpEmailSenderTests
{
    private static IEmailSender? SenderFor(Dictionary<string, string?> email)
    {
        var settings = new Dictionary<string, string?> { ["ConnectionStrings:Default"] = "Host=none;Database=none" };
        foreach (var (k, v) in email) settings[$"Email:{k}"] = v;
        var services = new ServiceCollection().AddLogging();
        services.AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        return services.BuildServiceProvider().GetService<IEmailSender>();
    }

    [Fact]
    public void AGmailLogin_PicksSmtp_ResendWinsWhenBothAreSet_AndNeitherSendsNothing()
    {
        var gmail = new Dictionary<string, string?> { ["SmtpUser"] = "cars@gmail.com", ["SmtpPassword"] = "app-password" };
        Assert.IsType<SmtpEmailSender>(SenderFor(gmail));
        Assert.IsType<ResendEmailSender>(SenderFor(new(gmail) { ["ResendApiKey"] = "re_x", ["From"] = "a@b.c" }));
        Assert.IsType<SmtpEmailSender>(SenderFor(new(gmail) { ["ResendApiKey"] = "re_x" }));
        Assert.Null(SenderFor(new() { ["ResendApiKey"] = "re_x" }));
        Assert.Null(SenderFor(new() { ["SmtpUser"] = "cars@gmail.com" }));
        Assert.Null(SenderFor(new()));
    }

    [Fact]
    public void TheMessage_IsUtf8Html_FromTheNamedAccount()
    {
        using var m = SmtpEmailSender.Message("OnlyCars <cars@gmail.com>", "me@example.com", "תזכורת: 2 משימות", "<p dir=\"rtl\">שלום</p>");

        Assert.Equal("cars@gmail.com", m.From!.Address);
        Assert.Equal("OnlyCars", m.From.DisplayName);
        Assert.Equal("me@example.com", m.To.Single().Address);
        Assert.True(m.IsBodyHtml);
        Assert.Equal(Encoding.UTF8, m.SubjectEncoding);
        Assert.Equal(Encoding.UTF8, m.BodyEncoding);
    }
}
