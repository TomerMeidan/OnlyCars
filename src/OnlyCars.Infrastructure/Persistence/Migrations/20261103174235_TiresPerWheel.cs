using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// TIRE-2: tire sets give way to one tire per wheel. Additive on live data: the five old tables are renamed Legacy_* (data, keys
    /// and cascades kept, out of the EF model; dropped in a later ticket) and copied into the new tables. Down drops the new tables
    /// and renames the old ones back.
    /// </summary>
    public partial class TiresPerWheel : Migration
    {
        // Constraint names are unique per schema, so the old ones move aside with their tables; index names are per table and stay.
        private static readonly (string Table, string[] Constraints)[] Old =
        [
            ("TireSets", ["PK_TireSets", "FK_TireSets_Users_UserId"]),
            ("TireMounts", ["PK_TireMounts", "FK_TireMounts_TireSets_TireSetId", "FK_TireMounts_Vehicles_VehicleId", "CK_TireMounts_Unmount"]),
            ("TireChecks", ["PK_TireChecks", "FK_TireChecks_TireMounts_TireMountId"]),
            ("TireMeasurements", ["PK_TireMeasurements", "FK_TireMeasurements_TireChecks_TireCheckId", "CK_TireMeasurements_Values"]),
            ("TireRotations", ["PK_TireRotations", "FK_TireRotations_TireMounts_TireMountId"]),
        ];

        private static string Legacy(string name) => name[..3] + "Legacy_" + name[3..];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var (table, constraints) in Old)
            {
                foreach (var c in constraints)
                {
                    migrationBuilder.Sql($"EXEC sp_rename N'{c}', N'{Legacy(c)}', N'OBJECT';");
                }

                migrationBuilder.RenameTable(name: table, newName: "Legacy_" + table);
            }

            migrationBuilder.CreateTable(
                name: "Tires",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false),
                    Brand = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Model = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Size = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: true),
                    Season = table.Column<int>(type: "int", nullable: false),
                    DotCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    PurchaseDate = table.Column<DateOnly>(type: "date", nullable: true),
                    FittedAt = table.Column<DateOnly>(type: "date", nullable: false),
                    FittedOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    RemovedAt = table.Column<DateOnly>(type: "date", nullable: true),
                    RemovedOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    ServiceRecordId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tires", x => x.Id);
                    table.CheckConstraint("CK_Tires_Removal", "([RemovedAt] IS NULL AND [RemovedOdometerKm] IS NULL) OR ([RemovedAt] >= [FittedAt] AND [RemovedOdometerKm] >= [FittedOdometerKm])");
                    table.ForeignKey(
                        name: "FK_Tires_ServiceRecords_ServiceRecordId",
                        column: x => x.ServiceRecordId,
                        principalTable: "ServiceRecords",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Tires_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireMeasurements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TireId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false),
                    MeasuredAt = table.Column<DateOnly>(type: "date", nullable: false),
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
                        name: "FK_TireMeasurements_Tires_TireId",
                        column: x => x.TireId,
                        principalTable: "Tires",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireRotations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
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
                        name: "FK_TireRotations_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireRotationMoves",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TireRotationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TireId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FromPosition = table.Column<int>(type: "int", nullable: false),
                    ToPosition = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireRotationMoves", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TireRotationMoves_TireRotations_TireRotationId",
                        column: x => x.TireRotationId,
                        principalTable: "TireRotations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TireRotationMoves_Tires_TireId",
                        column: x => x.TireId,
                        principalTable: "Tires",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_TireMeasurements_TireId_MeasuredAt",
                table: "TireMeasurements",
                columns: new[] { "TireId", "MeasuredAt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TireRotations_VehicleId_Date",
                table: "TireRotations",
                columns: new[] { "VehicleId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_TireRotationMoves_TireId",
                table: "TireRotationMoves",
                column: "TireId");

            migrationBuilder.CreateIndex(
                name: "IX_TireRotationMoves_TireRotationId_TireId",
                table: "TireRotationMoves",
                columns: new[] { "TireRotationId", "TireId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tires_ServiceRecordId",
                table: "Tires",
                column: "ServiceRecordId");

            migrationBuilder.CreateIndex(
                name: "IX_Tires_VehicleId_Position_OnCar",
                table: "Tires",
                columns: new[] { "VehicleId", "Position" },
                unique: true,
                filter: "[RemovedAt] IS NULL");

            // Every mount, open or closed, becomes FL, FR, RL, RR (Position 0 to 3) with its set's details, plus a Spare (4) when it had a
            // Spare measurement; old measurements go to the tire from their mount and position; old rotations become the car's, with no moves.
            // A set never mounted has no car and stays only in Legacy_TireSets.
            migrationBuilder.Sql("""
                DECLARE @map TABLE (TireId uniqueidentifier NOT NULL, MountId uniqueidentifier NOT NULL, Position int NOT NULL);

                INSERT INTO @map (TireId, MountId, Position)
                SELECT NEWID(), m.Id, p.Position
                FROM [Legacy_TireMounts] m
                CROSS JOIN (VALUES (0), (1), (2), (3), (4)) p (Position)
                WHERE p.Position < 4 OR EXISTS (
                    SELECT 1 FROM [Legacy_TireMeasurements] x JOIN [Legacy_TireChecks] c ON c.Id = x.TireCheckId
                    WHERE c.TireMountId = m.Id AND x.Position = 4);

                INSERT INTO [Tires] (Id, VehicleId, Position, Brand, Model, Size, Season, DotCode, PurchaseDate, FittedAt, FittedOdometerKm,
                    RemovedAt, RemovedOdometerKm, Notes, ServiceRecordId, CreatedAt, UpdatedAt)
                SELECT map.TireId, m.VehicleId, map.Position, s.Brand, s.Model, s.Size, s.Season, s.DotCode, s.PurchaseDate, m.MountedAt,
                    m.MountOdometerKm, m.UnmountedAt, m.UnmountOdometerKm, s.Notes, NULL, m.CreatedAt, m.UpdatedAt
                FROM @map map
                JOIN [Legacy_TireMounts] m ON m.Id = map.MountId
                JOIN [Legacy_TireSets] s ON s.Id = m.TireSetId;

                INSERT INTO [TireMeasurements] (Id, TireId, Position, MeasuredAt, PressureBar, TreadDepthMm, CreatedAt, UpdatedAt)
                SELECT x.Id, map.TireId, x.Position, c.MeasuredAt, x.PressureBar, x.TreadDepthMm, x.CreatedAt, x.UpdatedAt
                FROM [Legacy_TireMeasurements] x
                JOIN [Legacy_TireChecks] c ON c.Id = x.TireCheckId
                JOIN @map map ON map.MountId = c.TireMountId AND map.Position = x.Position;

                INSERT INTO [TireRotations] (Id, VehicleId, Date, OdometerKm, Notes, CreatedAt, UpdatedAt)
                SELECT r.Id, m.VehicleId, r.Date, r.OdometerKm, r.Notes, r.CreatedAt, r.UpdatedAt
                FROM [Legacy_TireRotations] r
                JOIN [Legacy_TireMounts] m ON m.Id = r.TireMountId;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "TireRotationMoves");
            migrationBuilder.DropTable(name: "TireMeasurements");
            migrationBuilder.DropTable(name: "TireRotations");
            migrationBuilder.DropTable(name: "Tires");

            foreach (var (table, constraints) in Old)
            {
                migrationBuilder.RenameTable(name: "Legacy_" + table, newName: table);
                foreach (var c in constraints)
                {
                    migrationBuilder.Sql($"EXEC sp_rename N'{Legacy(c)}', N'{c}', N'OBJECT';");
                }
            }
        }
    }
}
