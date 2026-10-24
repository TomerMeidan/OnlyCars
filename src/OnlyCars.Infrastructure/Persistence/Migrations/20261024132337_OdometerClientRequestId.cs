using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OdometerClientRequestId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ClientRequestId",
                table: "OdometerReadings",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_OdometerReadings_VehicleId_ClientRequestId",
                table: "OdometerReadings",
                columns: new[] { "VehicleId", "ClientRequestId" },
                unique: true,
                filter: "[ClientRequestId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_OdometerReadings_VehicleId_ClientRequestId",
                table: "OdometerReadings");

            migrationBuilder.DropColumn(
                name: "ClientRequestId",
                table: "OdometerReadings");
        }
    }
}
