using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMaintenanceTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TaskTemplates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Key = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Category = table.Column<int>(type: "int", nullable: false),
                    DefaultIntervalKm = table.Column<int>(type: "int", nullable: true),
                    DefaultIntervalDays = table.Column<int>(type: "int", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskTemplates", x => x.Id);
                    table.CheckConstraint("CK_TaskTemplates_Interval", "[DefaultIntervalKm] IS NOT NULL OR [DefaultIntervalDays] IS NOT NULL");
                });

            migrationBuilder.CreateTable(
                name: "MaintenanceTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Category = table.Column<int>(type: "int", nullable: false),
                    IntervalKm = table.Column<int>(type: "int", nullable: true),
                    IntervalDays = table.Column<int>(type: "int", nullable: true),
                    DueSoonPercent = table.Column<int>(type: "int", nullable: false),
                    IsEnabled = table.Column<bool>(type: "bit", nullable: false),
                    LastDoneOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    LastDoneDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MaintenanceTasks", x => x.Id);
                    table.CheckConstraint("CK_MaintenanceTasks_Interval", "[IntervalKm] IS NOT NULL OR [IntervalDays] IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_MaintenanceTasks_TaskTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalTable: "TaskTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceTasks_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "TaskTemplates",
                columns: new[] { "Id", "Category", "CreatedAt", "DefaultIntervalDays", "DefaultIntervalKm", "Key", "Name", "UpdatedAt" },
                values: new object[,]
                {
                    { new Guid("7a5c0000-0000-4000-8000-000000000001"), 0, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, 10000, "oilChange", "Engine oil and filter", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000002"), 1, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 730, 20000, "airFilter", "Air filter", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000003"), 1, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, 15000, "cabinFilter", "Cabin filter", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000004"), 2, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, 20000, "brakePads", "Brake pads check", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000005"), 4, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 730, null, "brakeFluid", "Brake fluid", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000006"), 4, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 1825, 60000, "coolant", "Coolant", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000007"), 4, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), null, 60000, "transmissionFluid", "Transmission fluid", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000008"), 7, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), null, 60000, "sparkPlugs", "Spark plugs", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000009"), 6, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 1825, 100000, "timingBelt", "Timing belt", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000010"), 3, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), null, 10000, "tireRotation", "Tire rotation", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000011"), 5, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, null, "battery", "Battery check", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000012"), 8, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, null, "wiperBlades", "Wiper blades", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) }
                });

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceTasks_TemplateId",
                table: "MaintenanceTasks",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceTasks_VehicleId_IsEnabled",
                table: "MaintenanceTasks",
                columns: new[] { "VehicleId", "IsEnabled" });

            migrationBuilder.CreateIndex(
                name: "IX_TaskTemplates_Key",
                table: "TaskTemplates",
                column: "Key",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MaintenanceTasks");

            migrationBuilder.DropTable(
                name: "TaskTemplates");
        }
    }
}
