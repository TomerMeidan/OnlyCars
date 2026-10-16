using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddChecklistRuns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VehicleChecklists",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    IntervalKm = table.Column<int>(type: "int", nullable: true),
                    IntervalDays = table.Column<int>(type: "int", nullable: true),
                    IsEnabled = table.Column<bool>(type: "bit", nullable: false),
                    LastRunOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    LastRunDate = table.Column<DateOnly>(type: "date", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    StartOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VehicleChecklists", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VehicleChecklists_ChecklistTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalTable: "ChecklistTemplates",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_VehicleChecklists_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChecklistRuns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleChecklistId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RunAt = table.Column<DateOnly>(type: "date", nullable: false),
                    OdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    OdometerReadingId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChecklistRuns_OdometerReadings_OdometerReadingId",
                        column: x => x.OdometerReadingId,
                        principalTable: "OdometerReadings",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ChecklistRuns_VehicleChecklists_VehicleChecklistId",
                        column: x => x.VehicleChecklistId,
                        principalTable: "VehicleChecklists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChecklistRunItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RunId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TemplateItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LabelSnapshot = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Type = table.Column<int>(type: "int", nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    MinValue = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    MaxValue = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    BoolValue = table.Column<bool>(type: "bit", nullable: true),
                    NumberValue = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    TextValue = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    IsFlagged = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistRunItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChecklistRunItems_ChecklistRuns_RunId",
                        column: x => x.RunId,
                        principalTable: "ChecklistRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ChecklistRunItems_ChecklistTemplateItems_TemplateItemId",
                        column: x => x.TemplateItemId,
                        principalTable: "ChecklistTemplateItems",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRunItems_RunId",
                table: "ChecklistRunItems",
                column: "RunId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRunItems_TemplateItemId",
                table: "ChecklistRunItems",
                column: "TemplateItemId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRuns_OdometerReadingId",
                table: "ChecklistRuns",
                column: "OdometerReadingId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRuns_VehicleChecklistId_RunAt",
                table: "ChecklistRuns",
                columns: new[] { "VehicleChecklistId", "RunAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_VehicleChecklists_TemplateId",
                table: "VehicleChecklists",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_VehicleChecklists_VehicleId_TemplateId",
                table: "VehicleChecklists",
                columns: new[] { "VehicleId", "TemplateId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChecklistRunItems");

            migrationBuilder.DropTable(
                name: "ChecklistRuns");

            migrationBuilder.DropTable(
                name: "VehicleChecklists");
        }
    }
}
