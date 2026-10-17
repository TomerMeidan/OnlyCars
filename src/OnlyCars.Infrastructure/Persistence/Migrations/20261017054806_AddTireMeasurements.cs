using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTireMeasurements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TireChecks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TireMountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MeasuredAt = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireChecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TireChecks_TireMounts_TireMountId",
                        column: x => x.TireMountId,
                        principalTable: "TireMounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireRotations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TireMountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    OdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireRotations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TireRotations_TireMounts_TireMountId",
                        column: x => x.TireMountId,
                        principalTable: "TireMounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireMeasurements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TireCheckId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false),
                    PressureBar = table.Column<decimal>(type: "decimal(4,2)", nullable: true),
                    TreadDepthMm = table.Column<decimal>(type: "decimal(4,1)", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireMeasurements", x => x.Id);
                    table.CheckConstraint("CK_TireMeasurements_Values", "([PressureBar] IS NOT NULL OR [TreadDepthMm] IS NOT NULL) AND ([PressureBar] IS NULL OR [PressureBar] BETWEEN 0.5 AND 6.0) AND ([TreadDepthMm] IS NULL OR [TreadDepthMm] BETWEEN 0 AND 20)");
                    table.ForeignKey(
                        name: "FK_TireMeasurements_TireChecks_TireCheckId",
                        column: x => x.TireCheckId,
                        principalTable: "TireChecks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TireChecks_TireMountId_MeasuredAt",
                table: "TireChecks",
                columns: new[] { "TireMountId", "MeasuredAt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TireMeasurements_TireCheckId_Position",
                table: "TireMeasurements",
                columns: new[] { "TireCheckId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TireRotations_TireMountId_Date",
                table: "TireRotations",
                columns: new[] { "TireMountId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TireMeasurements");

            migrationBuilder.DropTable(
                name: "TireRotations");

            migrationBuilder.DropTable(
                name: "TireChecks");
        }
    }
}
