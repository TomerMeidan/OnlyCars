using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;

namespace OnlyCars.Api.Common;

/// <summary>JSON options shared by Program.cs and the tests.</summary>
public static class ApiJson
{
    // Enum names only: a number binds even when the enum doesn't define it (fuelType: 99), and would reach the database (L65).
    public static void Configure(JsonOptions o) =>
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(allowIntegerValues: false));
}
