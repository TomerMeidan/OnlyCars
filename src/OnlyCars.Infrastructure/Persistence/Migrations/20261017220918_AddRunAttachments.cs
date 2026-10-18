using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRunAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ChecklistRunId",
                table: "Attachments",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_ChecklistRunId",
                table: "Attachments",
                column: "ChecklistRunId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attachments_OneParent",
                table: "Attachments",
                sql: "([ServiceRecordId] IS NOT NULL AND [ChecklistRunId] IS NULL) OR ([ServiceRecordId] IS NULL AND [ChecklistRunId] IS NOT NULL)");

            migrationBuilder.AddForeignKey(
                name: "FK_Attachments_ChecklistRuns_ChecklistRunId",
                table: "Attachments",
                column: "ChecklistRunId",
                principalTable: "ChecklistRuns",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Attachments_ChecklistRuns_ChecklistRunId",
                table: "Attachments");

            migrationBuilder.DropIndex(
                name: "IX_Attachments_ChecklistRunId",
                table: "Attachments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Attachments_OneParent",
                table: "Attachments");

            migrationBuilder.DropColumn(
                name: "ChecklistRunId",
                table: "Attachments");
        }
    }
}
