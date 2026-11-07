using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace OnlyCars.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Baseline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The provider writes a column's COLLATE without a schema; LOCAL: only for this migration's transaction, nothing depends on it after.
            migrationBuilder.Sql("SET LOCAL search_path = onlycars;");

            migrationBuilder.EnsureSchema(
                name: "onlycars");

            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:CollationDefinition:onlycars.und_ci", "und-u-ks-level2,und-u-ks-level2,icu,False");

            migrationBuilder.CreateTable(
                name: "TaskTemplates",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, collation: "und-x-icu"),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    NameHe = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    DefaultIntervalKm = table.Column<int>(type: "integer", nullable: true),
                    DefaultIntervalDays = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskTemplates", x => x.Id);
                    table.CheckConstraint("CK_TaskTemplates_Interval", "\"DefaultIntervalKm\" IS NOT NULL OR \"DefaultIntervalDays\" IS NOT NULL");
                });

            migrationBuilder.CreateTable(
                name: "Users",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false, collation: "und_ci"),
                    PasswordHash = table.Column<string>(type: "text", nullable: false, collation: "und-x-icu"),
                    GoogleSubject = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true, collation: "und-x-icu"),
                    DistanceUnit = table.Column<int>(type: "integer", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, collation: "und-x-icu"),
                    Locale = table.Column<int>(type: "integer", nullable: false),
                    Theme = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChecklistTemplates",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistTemplates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChecklistTemplates_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "onlycars",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NotificationRules",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Channel = table.Column<int>(type: "integer", nullable: false),
                    LeadDays = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    LastSentOn = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationRules", x => x.Id);
                    table.CheckConstraint("CK_NotificationRules_LeadDays", "\"LeadDays\" BETWEEN 1 AND 365");
                    table.ForeignKey(
                        name: "FK_NotificationRules_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "onlycars",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Notifications",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    RefId = table.Column<Guid>(type: "uuid", nullable: false),
                    SentAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SnoozedUntil = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Notifications_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "onlycars",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Vehicles",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Nickname = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    Make = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true, collation: "und-x-icu"),
                    Model = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true, collation: "und-x-icu"),
                    Year = table.Column<int>(type: "integer", nullable: true),
                    Vin = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true, collation: "und_ci"),
                    Plate = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true, collation: "und-x-icu"),
                    FuelType = table.Column<int>(type: "integer", nullable: true),
                    PurchaseDate = table.Column<DateOnly>(type: "date", nullable: true),
                    PurchasePrice = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    PhotoUrl = table.Column<string>(type: "text", nullable: true, collation: "und-x-icu"),
                    CurrentOdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    AvgKmPerDay = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    ArchivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Vehicles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Vehicles_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "onlycars",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChecklistTemplateItems",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true, collation: "und-x-icu"),
                    MinValue = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    MaxValue = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistTemplateItems", x => x.Id);
                    table.CheckConstraint("CK_ChecklistTemplateItems_Range", "\"MinValue\" IS NULL OR \"MaxValue\" IS NULL OR \"MinValue\" <= \"MaxValue\"");
                    table.ForeignKey(
                        name: "FK_ChecklistTemplateItems_ChecklistTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalSchema: "onlycars",
                        principalTable: "ChecklistTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MaintenanceTasks",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    IntervalKm = table.Column<int>(type: "integer", nullable: true),
                    IntervalDays = table.Column<int>(type: "integer", nullable: true),
                    DueSoonPercent = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    LastDoneOdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    LastDoneDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MaintenanceTasks", x => x.Id);
                    table.CheckConstraint("CK_MaintenanceTasks_Interval", "\"IntervalKm\" IS NOT NULL OR \"IntervalDays\" IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_MaintenanceTasks_TaskTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalSchema: "onlycars",
                        principalTable: "TaskTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceTasks_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServiceRecords",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    OdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    ShopName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true, collation: "und-x-icu"),
                    TotalCost = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true, collation: "und-x-icu"),
                    IsVoided = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceRecords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceRecords_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireRotations",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    OdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true, collation: "und-x-icu"),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireRotations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TireRotations_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VehicleChecklists",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    IntervalKm = table.Column<int>(type: "integer", nullable: true),
                    IntervalDays = table.Column<int>(type: "integer", nullable: true),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    LastRunOdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    LastRunDate = table.Column<DateOnly>(type: "date", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    StartOdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VehicleChecklists", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VehicleChecklists_ChecklistTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalSchema: "onlycars",
                        principalTable: "ChecklistTemplates",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_VehicleChecklists_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VehicleDocuments",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    ExpiryDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Cost = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true, collation: "und-x-icu"),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VehicleDocuments", x => x.Id);
                    table.CheckConstraint("CK_VehicleDocuments_Cost", "\"Cost\" IS NULL OR \"Cost\" >= 0");
                    table.ForeignKey(
                        name: "FK_VehicleDocuments_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OdometerReadings",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    ValueKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    ReadingDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Source = table.Column<int>(type: "integer", nullable: false),
                    ServiceRecordId = table.Column<Guid>(type: "uuid", nullable: true),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OdometerReadings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OdometerReadings_ServiceRecords_ServiceRecordId",
                        column: x => x.ServiceRecordId,
                        principalSchema: "onlycars",
                        principalTable: "ServiceRecords",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_OdometerReadings_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServiceItems",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceRecordId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    Brand = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true, collation: "und-x-icu"),
                    PartNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true, collation: "und-x-icu"),
                    Quantity = table.Column<decimal>(type: "numeric(9,2)", nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    IsLabor = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceItems", x => x.Id);
                    table.CheckConstraint("CK_ServiceItems_Quantity", "\"Quantity\" > 0");
                    table.CheckConstraint("CK_ServiceItems_UnitCost", "\"UnitCost\" >= 0");
                    table.ForeignKey(
                        name: "FK_ServiceItems_ServiceRecords_ServiceRecordId",
                        column: x => x.ServiceRecordId,
                        principalSchema: "onlycars",
                        principalTable: "ServiceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServiceRecordTasks",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceRecordId = table.Column<Guid>(type: "uuid", nullable: false),
                    MaintenanceTaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    PreviousLastDoneOdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    PreviousLastDoneDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceRecordTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceRecordTasks_MaintenanceTasks_MaintenanceTaskId",
                        column: x => x.MaintenanceTaskId,
                        principalSchema: "onlycars",
                        principalTable: "MaintenanceTasks",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ServiceRecordTasks_ServiceRecords_ServiceRecordId",
                        column: x => x.ServiceRecordId,
                        principalSchema: "onlycars",
                        principalTable: "ServiceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Tires",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Brand = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, collation: "und-x-icu"),
                    Model = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true, collation: "und-x-icu"),
                    Size = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true, collation: "und-x-icu"),
                    Season = table.Column<int>(type: "integer", nullable: false),
                    DotCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true, collation: "und-x-icu"),
                    PurchaseDate = table.Column<DateOnly>(type: "date", nullable: true),
                    FittedAt = table.Column<DateOnly>(type: "date", nullable: false),
                    FittedOdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    RemovedAt = table.Column<DateOnly>(type: "date", nullable: true),
                    RemovedOdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true, collation: "und-x-icu"),
                    ServiceRecordId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tires", x => x.Id);
                    table.CheckConstraint("CK_Tires_Removal", "(\"RemovedAt\" IS NULL AND \"RemovedOdometerKm\" IS NULL) OR (\"RemovedAt\" >= \"FittedAt\" AND \"RemovedOdometerKm\" >= \"FittedOdometerKm\")");
                    table.ForeignKey(
                        name: "FK_Tires_ServiceRecords_ServiceRecordId",
                        column: x => x.ServiceRecordId,
                        principalSchema: "onlycars",
                        principalTable: "ServiceRecords",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Tires_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChecklistRuns",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleChecklistId = table.Column<Guid>(type: "uuid", nullable: false),
                    RunAt = table.Column<DateOnly>(type: "date", nullable: false),
                    OdometerKm = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true, collation: "und-x-icu"),
                    OdometerReadingId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChecklistRuns_OdometerReadings_OdometerReadingId",
                        column: x => x.OdometerReadingId,
                        principalSchema: "onlycars",
                        principalTable: "OdometerReadings",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ChecklistRuns_VehicleChecklists_VehicleChecklistId",
                        column: x => x.VehicleChecklistId,
                        principalSchema: "onlycars",
                        principalTable: "VehicleChecklists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireMeasurements",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TireId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    MeasuredAt = table.Column<DateOnly>(type: "date", nullable: false),
                    PressureBar = table.Column<decimal>(type: "numeric(4,2)", nullable: true),
                    TreadDepthMm = table.Column<decimal>(type: "numeric(4,1)", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireMeasurements", x => x.Id);
                    table.CheckConstraint("CK_TireMeasurements_Values", "(\"PressureBar\" IS NOT NULL OR \"TreadDepthMm\" IS NOT NULL) AND (\"PressureBar\" IS NULL OR \"PressureBar\" BETWEEN 0.5 AND 6.0) AND (\"TreadDepthMm\" IS NULL OR \"TreadDepthMm\" BETWEEN 0 AND 20)");
                    table.ForeignKey(
                        name: "FK_TireMeasurements_Tires_TireId",
                        column: x => x.TireId,
                        principalSchema: "onlycars",
                        principalTable: "Tires",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TireRotationMoves",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TireRotationId = table.Column<Guid>(type: "uuid", nullable: false),
                    TireId = table.Column<Guid>(type: "uuid", nullable: false),
                    FromPosition = table.Column<int>(type: "integer", nullable: false),
                    ToPosition = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TireRotationMoves", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TireRotationMoves_TireRotations_TireRotationId",
                        column: x => x.TireRotationId,
                        principalSchema: "onlycars",
                        principalTable: "TireRotations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TireRotationMoves_Tires_TireId",
                        column: x => x.TireId,
                        principalSchema: "onlycars",
                        principalTable: "Tires",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Attachments",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceRecordId = table.Column<Guid>(type: "uuid", nullable: true),
                    ChecklistRunId = table.Column<Guid>(type: "uuid", nullable: true),
                    VehicleDocumentId = table.Column<Guid>(type: "uuid", nullable: true),
                    FileUrl = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false, collation: "und-x-icu"),
                    FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false, collation: "und-x-icu"),
                    ContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Attachments", x => x.Id);
                    table.CheckConstraint("CK_Attachments_OneParent", "(CASE WHEN \"ServiceRecordId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ChecklistRunId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"VehicleDocumentId\" IS NULL THEN 0 ELSE 1 END) = 1");
                    table.ForeignKey(
                        name: "FK_Attachments_ChecklistRuns_ChecklistRunId",
                        column: x => x.ChecklistRunId,
                        principalSchema: "onlycars",
                        principalTable: "ChecklistRuns",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Attachments_ServiceRecords_ServiceRecordId",
                        column: x => x.ServiceRecordId,
                        principalSchema: "onlycars",
                        principalTable: "ServiceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Attachments_VehicleDocuments_VehicleDocumentId",
                        column: x => x.VehicleDocumentId,
                        principalSchema: "onlycars",
                        principalTable: "VehicleDocuments",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ChecklistRunItems",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RunId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    LabelSnapshot = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true, collation: "und-x-icu"),
                    MinValue = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    MaxValue = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    BoolValue = table.Column<bool>(type: "boolean", nullable: true),
                    NumberValue = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    TextValue = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true, collation: "und-x-icu"),
                    IsFlagged = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChecklistRunItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChecklistRunItems_ChecklistRuns_RunId",
                        column: x => x.RunId,
                        principalSchema: "onlycars",
                        principalTable: "ChecklistRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ChecklistRunItems_ChecklistTemplateItems_TemplateItemId",
                        column: x => x.TemplateItemId,
                        principalSchema: "onlycars",
                        principalTable: "ChecklistTemplateItems",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Issues",
                schema: "onlycars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, collation: "und-x-icu"),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true, collation: "und-x-icu"),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    SourceRunItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    ResolvedAt = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Issues", x => x.Id);
                    table.CheckConstraint("CK_Issues_ResolvedAt", "(\"Status\" = 0 AND \"ResolvedAt\" IS NULL) OR (\"Status\" = 1 AND \"ResolvedAt\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_Issues_ChecklistRunItems_SourceRunItemId",
                        column: x => x.SourceRunItemId,
                        principalSchema: "onlycars",
                        principalTable: "ChecklistRunItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Issues_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalSchema: "onlycars",
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                schema: "onlycars",
                table: "TaskTemplates",
                columns: new[] { "Id", "Category", "CreatedAt", "DefaultIntervalDays", "DefaultIntervalKm", "Key", "Name", "NameHe", "UpdatedAt" },
                values: new object[,]
                {
                    { new Guid("7a5c0000-0000-4000-8000-000000000001"), 0, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, 10000, "oilChange", "Engine oil and filter", "שמן מנוע ופילטר שמן", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000002"), 1, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 730, 20000, "airFilter", "Air filter", "פילטר אוויר", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000003"), 1, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, 15000, "cabinFilter", "Cabin filter", "פילטר מזגן", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000004"), 2, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, 20000, "brakePads", "Brake pads check", "בדיקת רפידות בלמים", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000005"), 4, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 730, null, "brakeFluid", "Brake fluid", "נוזל בלמים", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000006"), 4, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 1825, 60000, "coolant", "Coolant", "נוזל קירור", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000007"), 4, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), null, 60000, "transmissionFluid", "Transmission fluid", "שמן גיר", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000008"), 7, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), null, 60000, "sparkPlugs", "Spark plugs", "מצתים", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000009"), 6, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 1825, 100000, "timingBelt", "Timing belt", "רצועת טיימינג", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000010"), 3, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), null, 10000, "tireRotation", "Tire rotation", "רוטציית צמיגים", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000011"), 5, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, null, "battery", "Battery check", "בדיקת מצבר", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { new Guid("7a5c0000-0000-4000-8000-000000000012"), 8, new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), 365, null, "wiperBlades", "Wiper blades", "מגבים", new DateTimeOffset(new DateTime(2026, 10, 14, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) }
                });

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_ChecklistRunId",
                schema: "onlycars",
                table: "Attachments",
                column: "ChecklistRunId");

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_ServiceRecordId",
                schema: "onlycars",
                table: "Attachments",
                column: "ServiceRecordId");

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_VehicleDocumentId",
                schema: "onlycars",
                table: "Attachments",
                column: "VehicleDocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRunItems_RunId",
                schema: "onlycars",
                table: "ChecklistRunItems",
                column: "RunId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRunItems_TemplateItemId",
                schema: "onlycars",
                table: "ChecklistRunItems",
                column: "TemplateItemId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRuns_OdometerReadingId",
                schema: "onlycars",
                table: "ChecklistRuns",
                column: "OdometerReadingId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistRuns_VehicleChecklistId_RunAt",
                schema: "onlycars",
                table: "ChecklistRuns",
                columns: new[] { "VehicleChecklistId", "RunAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistTemplateItems_TemplateId",
                schema: "onlycars",
                table: "ChecklistTemplateItems",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_ChecklistTemplates_UserId",
                schema: "onlycars",
                table: "ChecklistTemplates",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Issues_SourceRunItemId",
                schema: "onlycars",
                table: "Issues",
                column: "SourceRunItemId",
                unique: true,
                filter: "\"SourceRunItemId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Issues_VehicleId",
                schema: "onlycars",
                table: "Issues",
                column: "VehicleId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceTasks_TemplateId",
                schema: "onlycars",
                table: "MaintenanceTasks",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceTasks_VehicleId_IsEnabled",
                schema: "onlycars",
                table: "MaintenanceTasks",
                columns: new[] { "VehicleId", "IsEnabled" });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationRules_UserId_Channel",
                schema: "onlycars",
                table: "NotificationRules",
                columns: new[] { "UserId", "Channel" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_UserId_Kind_RefId",
                schema: "onlycars",
                table: "Notifications",
                columns: new[] { "UserId", "Kind", "RefId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OdometerReadings_ServiceRecordId",
                schema: "onlycars",
                table: "OdometerReadings",
                column: "ServiceRecordId");

            migrationBuilder.CreateIndex(
                name: "IX_OdometerReadings_VehicleId_ClientRequestId",
                schema: "onlycars",
                table: "OdometerReadings",
                columns: new[] { "VehicleId", "ClientRequestId" },
                unique: true,
                filter: "\"ClientRequestId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_OdometerReadings_VehicleId_ReadingDate",
                schema: "onlycars",
                table: "OdometerReadings",
                columns: new[] { "VehicleId", "ReadingDate" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceItems_ServiceRecordId",
                schema: "onlycars",
                table: "ServiceItems",
                column: "ServiceRecordId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecords_VehicleId_Date",
                schema: "onlycars",
                table: "ServiceRecords",
                columns: new[] { "VehicleId", "Date" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecordTasks_MaintenanceTaskId",
                schema: "onlycars",
                table: "ServiceRecordTasks",
                column: "MaintenanceTaskId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecordTasks_ServiceRecordId_MaintenanceTaskId",
                schema: "onlycars",
                table: "ServiceRecordTasks",
                columns: new[] { "ServiceRecordId", "MaintenanceTaskId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TaskTemplates_Key",
                schema: "onlycars",
                table: "TaskTemplates",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TireMeasurements_TireId_MeasuredAt",
                schema: "onlycars",
                table: "TireMeasurements",
                columns: new[] { "TireId", "MeasuredAt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TireRotationMoves_TireId",
                schema: "onlycars",
                table: "TireRotationMoves",
                column: "TireId");

            migrationBuilder.CreateIndex(
                name: "IX_TireRotationMoves_TireRotationId_TireId",
                schema: "onlycars",
                table: "TireRotationMoves",
                columns: new[] { "TireRotationId", "TireId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TireRotations_VehicleId_Date",
                schema: "onlycars",
                table: "TireRotations",
                columns: new[] { "VehicleId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_Tires_ServiceRecordId",
                schema: "onlycars",
                table: "Tires",
                column: "ServiceRecordId");

            migrationBuilder.CreateIndex(
                name: "IX_Tires_VehicleId_Position_OnCar",
                schema: "onlycars",
                table: "Tires",
                columns: new[] { "VehicleId", "Position" },
                unique: true,
                filter: "\"RemovedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                schema: "onlycars",
                table: "Users",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_GoogleSubject",
                schema: "onlycars",
                table: "Users",
                column: "GoogleSubject",
                unique: true,
                filter: "\"GoogleSubject\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_VehicleChecklists_TemplateId",
                schema: "onlycars",
                table: "VehicleChecklists",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_VehicleChecklists_VehicleId_TemplateId",
                schema: "onlycars",
                table: "VehicleChecklists",
                columns: new[] { "VehicleId", "TemplateId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VehicleDocuments_VehicleId_ExpiryDate",
                schema: "onlycars",
                table: "VehicleDocuments",
                columns: new[] { "VehicleId", "ExpiryDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Vehicles_UserId_Vin",
                schema: "onlycars",
                table: "Vehicles",
                columns: new[] { "UserId", "Vin" },
                unique: true,
                filter: "\"Vin\" IS NOT NULL");

            // SQL Server checks a NO ACTION key at the end of the whole statement, cascades included; Postgres at the end of each cascaded step, so
            // deleting a car or user whose rows reach one parent by two paths would fail. Deferred, the check runs at commit: a delete that takes
            // both ends goes through, a raw delete of just the parent is still refused. Attachments' two keys stay immediate: AttachmentFiles
            // needs their violation as a DbUpdateException on the save, and the services delete those rows first (DB-1a contract).
            foreach (var (table, key) in new[]
            {
                ("VehicleChecklists", "FK_VehicleChecklists_ChecklistTemplates_TemplateId"),
                ("OdometerReadings", "FK_OdometerReadings_ServiceRecords_ServiceRecordId"),
                ("ServiceRecordTasks", "FK_ServiceRecordTasks_MaintenanceTasks_MaintenanceTaskId"),
                ("Tires", "FK_Tires_ServiceRecords_ServiceRecordId"),
                ("ChecklistRuns", "FK_ChecklistRuns_OdometerReadings_OdometerReadingId"),
                ("TireRotationMoves", "FK_TireRotationMoves_Tires_TireId"),
                ("ChecklistRunItems", "FK_ChecklistRunItems_ChecklistTemplateItems_TemplateItemId"),
                ("Issues", "FK_Issues_ChecklistRunItems_SourceRunItemId"),
            })
            {
                migrationBuilder.Sql($"ALTER TABLE onlycars.\"{table}\" ALTER CONSTRAINT \"{key}\" DEFERRABLE INITIALLY DEFERRED;");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Attachments",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "Issues",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "NotificationRules",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "Notifications",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "ServiceItems",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "ServiceRecordTasks",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "TireMeasurements",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "TireRotationMoves",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "VehicleDocuments",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "ChecklistRunItems",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "MaintenanceTasks",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "TireRotations",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "Tires",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "ChecklistRuns",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "ChecklistTemplateItems",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "TaskTemplates",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "OdometerReadings",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "VehicleChecklists",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "ServiceRecords",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "ChecklistTemplates",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "Vehicles",
                schema: "onlycars");

            migrationBuilder.DropTable(
                name: "Users",
                schema: "onlycars");
        }
    }
}
