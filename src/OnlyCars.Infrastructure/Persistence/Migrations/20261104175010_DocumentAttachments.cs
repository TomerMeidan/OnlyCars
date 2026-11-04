using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DocumentAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Attachments_OneParent",
                table: "Attachments");

            migrationBuilder.AddColumn<Guid>(
                name: "VehicleDocumentId",
                table: "Attachments",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_VehicleDocumentId",
                table: "Attachments",
                column: "VehicleDocumentId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attachments_OneParent",
                table: "Attachments",
                sql: "(CASE WHEN [ServiceRecordId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [ChecklistRunId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [VehicleDocumentId] IS NULL THEN 0 ELSE 1 END) = 1");

            migrationBuilder.AddForeignKey(
                name: "FK_Attachments_VehicleDocuments_VehicleDocumentId",
                table: "Attachments",
                column: "VehicleDocumentId",
                principalTable: "VehicleDocuments",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Attachments_VehicleDocuments_VehicleDocumentId",
                table: "Attachments");

            migrationBuilder.DropIndex(
                name: "IX_Attachments_VehicleDocumentId",
                table: "Attachments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Attachments_OneParent",
                table: "Attachments");

            migrationBuilder.DropColumn(
                name: "VehicleDocumentId",
                table: "Attachments");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attachments_OneParent",
                table: "Attachments",
                sql: "([ServiceRecordId] IS NOT NULL AND [ChecklistRunId] IS NULL) OR ([ServiceRecordId] IS NULL AND [ChecklistRunId] IS NOT NULL)");
        }
    }
}
