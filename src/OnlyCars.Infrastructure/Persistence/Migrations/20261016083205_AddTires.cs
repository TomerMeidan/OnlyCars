using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTires : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TireSets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Brand = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Model = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Size = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: true),
                    Season = table.Column<int>(type: "int", nullable: false),
                    PurchaseDate = table.Column<DateOnly>(type: "date", nullable: true),
                    DotCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireSets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TireSets_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireMounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TireSetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MountedAt = table.Column<DateOnly>(type: "date", nullable: false),
                    MountOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    UnmountedAt = table.Column<DateOnly>(type: "date", nullable: true),
                    UnmountOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireMounts", x => x.Id);
                    table.CheckConstraint("CK_TireMounts_Unmount", "([UnmountedAt] IS NULL AND [UnmountOdometerKm] IS NULL) OR ([UnmountedAt] >= [MountedAt] AND [UnmountOdometerKm] >= [MountOdometerKm])");
                    table.ForeignKey(
                        name: "FK_TireMounts_TireSets_TireSetId",
                        column: x => x.TireSetId,
                        principalTable: "TireSets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TireMounts_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalTable: "Vehicles",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_TireMounts_TireSetId_MountedAt",
                table: "TireMounts",
                columns: new[] { "TireSetId", "MountedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TireMounts_TireSetId_Open",
                table: "TireMounts",
                column: "TireSetId",
                unique: true,
                filter: "[UnmountedAt] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TireMounts_VehicleId_MountedAt",
                table: "TireMounts",
                columns: new[] { "VehicleId", "MountedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TireMounts_VehicleId_Open",
                table: "TireMounts",
                column: "VehicleId",
                unique: true,
                filter: "[UnmountedAt] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TireSets_UserId",
                table: "TireSets",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TireMounts");

            migrationBuilder.DropTable(
                name: "TireSets");
        }
    }
}
