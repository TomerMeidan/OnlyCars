using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailDigest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsEnabled",
                table: "NotificationRules",
                type: "bit",
                nullable: false,
                defaultValue: true); // existing rows are InApp, where it is unused; true matches the entity default

            migrationBuilder.AddColumn<DateOnly>(
                name: "LastSentOn",
                table: "NotificationRules",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsEnabled",
                table: "NotificationRules");

            migrationBuilder.DropColumn(
                name: "LastSentOn",
                table: "NotificationRules");
        }
    }
}
