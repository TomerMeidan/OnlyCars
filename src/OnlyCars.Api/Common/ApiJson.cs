using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;

namespace OnlyCars.Api.Common;

/// <summary>JSON options shared by Program.cs and the tests.</summary>
public static class ApiJson
{
    public static void Configure(JsonOptions o)
    {
        // Enum names only: a number binds even when the enum doesn't define it (fuelType: 99), and would reach the database (L65).
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(allowIntegerValues: false));
        o.JsonSerializerOptions.Converters.Add(new NoNulStrings());
    }

    /// <summary>Postgres text can't hold \u0000, so a string with it is a model-binding 400, before it reaches a save or a query (DB-1b).</summary>
    private sealed class NoNulStrings : JsonConverter<string>
    {
        public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var text = reader.GetString();
            return text?.Contains('\0') == true ? throw new JsonException("The text contains a NUL character.") : text;
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options) => writer.WriteStringValue(value);
    }
}
