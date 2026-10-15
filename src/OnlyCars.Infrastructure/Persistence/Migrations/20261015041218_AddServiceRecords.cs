using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ServiceRecordId",
                table: "OdometerReadings",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ServiceRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    OdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    ShopName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    TotalCost = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    IsVoided = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceRecords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceRecords_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServiceRecordTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ServiceRecordId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MaintenanceTaskId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PreviousLastDoneOdometerKm = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    PreviousLastDoneDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceRecordTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceRecordTasks_MaintenanceTasks_MaintenanceTaskId",
                        column: x => x.MaintenanceTaskId,
                        principalTable: "MaintenanceTasks",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ServiceRecordTasks_ServiceRecords_ServiceRecordId",
                        column: x => x.ServiceRecordId,
                        principalTable: "ServiceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OdometerReadings_ServiceRecordId",
                table: "OdometerReadings",
                column: "ServiceRecordId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecords_VehicleId_Date",
                table: "ServiceRecords",
                columns: new[] { "VehicleId", "Date" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecordTasks_MaintenanceTaskId",
                table: "ServiceRecordTasks",
                column: "MaintenanceTaskId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecordTasks_ServiceRecordId_MaintenanceTaskId",
                table: "ServiceRecordTasks",
                columns: new[] { "ServiceRecordId", "MaintenanceTaskId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_OdometerReadings_ServiceRecords_ServiceRecordId",
                table: "OdometerReadings",
                column: "ServiceRecordId",
                principalTable: "ServiceRecords",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_OdometerReadings_ServiceRecords_ServiceRecordId",
                table: "OdometerReadings");

            migrationBuilder.DropTable(
                name: "ServiceRecordTasks");

            migrationBuilder.DropTable(
                name: "ServiceRecords");

            migrationBuilder.DropIndex(
                name: "IX_OdometerReadings_ServiceRecordId",
                table: "OdometerReadings");

            migrationBuilder.DropColumn(
                name: "ServiceRecordId",
                table: "OdometerReadings");
        }
    }
}
