using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TemplateHebrewNames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NameHe",
                table: "TaskTemplates",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000001"),
                column: "NameHe",
                value: "שמן מנוע ופילטר שמן");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000002"),
                column: "NameHe",
                value: "פילטר אוויר");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000003"),
                column: "NameHe",
                value: "פילטר מזגן");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000004"),
                column: "NameHe",
                value: "בדיקת רפידות בלמים");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000005"),
                column: "NameHe",
                value: "נוזל בלמים");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000006"),
                column: "NameHe",
                value: "נוזל קירור");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000007"),
                column: "NameHe",
                value: "שמן גיר");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000008"),
                column: "NameHe",
                value: "מצתים");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000009"),
                column: "NameHe",
                value: "רצועת טיימינג");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000010"),
                column: "NameHe",
                value: "רוטציית צמיגים");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000011"),
                column: "NameHe",
                value: "בדיקת מצבר");

            migrationBuilder.UpdateData(
                table: "TaskTemplates",
                keyColumn: "Id",
                keyValue: new Guid("7a5c0000-0000-4000-8000-000000000012"),
                column: "NameHe",
                value: "מגבים");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NameHe",
                table: "TaskTemplates");
        }
    }
}
