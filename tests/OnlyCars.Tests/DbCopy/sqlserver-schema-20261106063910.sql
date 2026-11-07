IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014171611_InitialCreate'
)
BEGIN
    CREATE TABLE [Users] (
        [Id] uniqueidentifier NOT NULL,
        [Email] nvarchar(256) NOT NULL,
        [PasswordHash] nvarchar(max) NOT NULL,
        [DistanceUnit] int NOT NULL,
        [Currency] nvarchar(3) NOT NULL,
        [Locale] int NOT NULL,
        [Theme] int NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Users] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014171611_InitialCreate'
)
BEGIN
    CREATE TABLE [Vehicles] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Nickname] nvarchar(100) NOT NULL,
        [Make] nvarchar(100) NULL,
        [Model] nvarchar(100) NULL,
        [Year] int NULL,
        [Vin] nvarchar(32) NULL,
        [Plate] nvarchar(32) NULL,
        [FuelType] int NULL,
        [PurchaseDate] date NULL,
        [PurchasePrice] decimal(12,2) NULL,
        [PhotoUrl] nvarchar(max) NULL,
        [CurrentOdometerKm] decimal(12,2) NOT NULL,
        [AvgKmPerDay] decimal(12,2) NULL,
        [IsArchived] bit NOT NULL,
        [ArchivedAt] datetimeoffset NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Vehicles] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Vehicles_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014171611_InitialCreate'
)
BEGIN
    CREATE TABLE [OdometerReadings] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [ValueKm] decimal(12,2) NOT NULL,
        [ReadingDate] date NOT NULL,
        [Source] int NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_OdometerReadings] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_OdometerReadings_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014171611_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_OdometerReadings_VehicleId_ReadingDate] ON [OdometerReadings] ([VehicleId], [ReadingDate] DESC);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014171611_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Users_Email] ON [Users] ([Email]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014171611_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Vehicles_UserId_Vin] ON [Vehicles] ([UserId], [Vin]) WHERE [Vin] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014171611_InitialCreate'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261014171611_InitialCreate', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014191520_AddMaintenanceTasks'
)
BEGIN
    CREATE TABLE [TaskTemplates] (
        [Id] uniqueidentifier NOT NULL,
        [Key] nvarchar(50) NOT NULL,
        [Name] nvarchar(100) NOT NULL,
        [Category] int NOT NULL,
        [DefaultIntervalKm] int NULL,
        [DefaultIntervalDays] int NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TaskTemplates] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_TaskTemplates_Interval] CHECK ([DefaultIntervalKm] IS NOT NULL OR [DefaultIntervalDays] IS NOT NULL)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014191520_AddMaintenanceTasks'
)
BEGIN
    CREATE TABLE [MaintenanceTasks] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [TemplateId] uniqueidentifier NULL,
        [Name] nvarchar(100) NOT NULL,
        [Category] int NOT NULL,
        [IntervalKm] int NULL,
        [IntervalDays] int NULL,
        [DueSoonPercent] int NOT NULL,
        [IsEnabled] bit NOT NULL,
        [LastDoneOdometerKm] decimal(12,2) NOT NULL,
        [LastDoneDate] date NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_MaintenanceTasks] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_MaintenanceTasks_Interval] CHECK ([IntervalKm] IS NOT NULL OR [IntervalDays] IS NOT NULL),
        CONSTRAINT [FK_MaintenanceTasks_TaskTemplates_TemplateId] FOREIGN KEY ([TemplateId]) REFERENCES [TaskTemplates] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_MaintenanceTasks_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014191520_AddMaintenanceTasks'
)
BEGIN
    IF EXISTS (SELECT * FROM [sys].[identity_columns] WHERE [name] IN (N'Id', N'Category', N'CreatedAt', N'DefaultIntervalDays', N'DefaultIntervalKm', N'Key', N'Name', N'UpdatedAt') AND [object_id] = OBJECT_ID(N'[TaskTemplates]'))
        SET IDENTITY_INSERT [TaskTemplates] ON;
    EXEC(N'INSERT INTO [TaskTemplates] ([Id], [Category], [CreatedAt], [DefaultIntervalDays], [DefaultIntervalKm], [Key], [Name], [UpdatedAt])
    VALUES (''7a5c0000-0000-4000-8000-000000000001'', 0, ''2026-10-14T00:00:00.0000000+00:00'', 365, 10000, N''oilChange'', N''Engine oil and filter'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000002'', 1, ''2026-10-14T00:00:00.0000000+00:00'', 730, 20000, N''airFilter'', N''Air filter'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000003'', 1, ''2026-10-14T00:00:00.0000000+00:00'', 365, 15000, N''cabinFilter'', N''Cabin filter'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000004'', 2, ''2026-10-14T00:00:00.0000000+00:00'', 365, 20000, N''brakePads'', N''Brake pads check'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000005'', 4, ''2026-10-14T00:00:00.0000000+00:00'', 730, NULL, N''brakeFluid'', N''Brake fluid'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000006'', 4, ''2026-10-14T00:00:00.0000000+00:00'', 1825, 60000, N''coolant'', N''Coolant'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000007'', 4, ''2026-10-14T00:00:00.0000000+00:00'', NULL, 60000, N''transmissionFluid'', N''Transmission fluid'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000008'', 7, ''2026-10-14T00:00:00.0000000+00:00'', NULL, 60000, N''sparkPlugs'', N''Spark plugs'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000009'', 6, ''2026-10-14T00:00:00.0000000+00:00'', 1825, 100000, N''timingBelt'', N''Timing belt'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000010'', 3, ''2026-10-14T00:00:00.0000000+00:00'', NULL, 10000, N''tireRotation'', N''Tire rotation'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000011'', 5, ''2026-10-14T00:00:00.0000000+00:00'', 365, NULL, N''battery'', N''Battery check'', ''2026-10-14T00:00:00.0000000+00:00''),
    (''7a5c0000-0000-4000-8000-000000000012'', 8, ''2026-10-14T00:00:00.0000000+00:00'', 365, NULL, N''wiperBlades'', N''Wiper blades'', ''2026-10-14T00:00:00.0000000+00:00'')');
    IF EXISTS (SELECT * FROM [sys].[identity_columns] WHERE [name] IN (N'Id', N'Category', N'CreatedAt', N'DefaultIntervalDays', N'DefaultIntervalKm', N'Key', N'Name', N'UpdatedAt') AND [object_id] = OBJECT_ID(N'[TaskTemplates]'))
        SET IDENTITY_INSERT [TaskTemplates] OFF;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014191520_AddMaintenanceTasks'
)
BEGIN
    CREATE INDEX [IX_MaintenanceTasks_TemplateId] ON [MaintenanceTasks] ([TemplateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014191520_AddMaintenanceTasks'
)
BEGIN
    CREATE INDEX [IX_MaintenanceTasks_VehicleId_IsEnabled] ON [MaintenanceTasks] ([VehicleId], [IsEnabled]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014191520_AddMaintenanceTasks'
)
BEGIN
    CREATE UNIQUE INDEX [IX_TaskTemplates_Key] ON [TaskTemplates] ([Key]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261014191520_AddMaintenanceTasks'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261014191520_AddMaintenanceTasks', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    ALTER TABLE [OdometerReadings] ADD [ServiceRecordId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    CREATE TABLE [ServiceRecords] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [Date] date NOT NULL,
        [OdometerKm] decimal(12,2) NOT NULL,
        [ShopName] nvarchar(100) NULL,
        [TotalCost] decimal(12,2) NULL,
        [Notes] nvarchar(1000) NULL,
        [IsVoided] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ServiceRecords] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ServiceRecords_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    CREATE TABLE [ServiceRecordTasks] (
        [Id] uniqueidentifier NOT NULL,
        [ServiceRecordId] uniqueidentifier NOT NULL,
        [MaintenanceTaskId] uniqueidentifier NOT NULL,
        [PreviousLastDoneOdometerKm] decimal(12,2) NOT NULL,
        [PreviousLastDoneDate] date NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ServiceRecordTasks] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ServiceRecordTasks_MaintenanceTasks_MaintenanceTaskId] FOREIGN KEY ([MaintenanceTaskId]) REFERENCES [MaintenanceTasks] ([Id]),
        CONSTRAINT [FK_ServiceRecordTasks_ServiceRecords_ServiceRecordId] FOREIGN KEY ([ServiceRecordId]) REFERENCES [ServiceRecords] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    CREATE INDEX [IX_OdometerReadings_ServiceRecordId] ON [OdometerReadings] ([ServiceRecordId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    CREATE INDEX [IX_ServiceRecords_VehicleId_Date] ON [ServiceRecords] ([VehicleId], [Date] DESC);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    CREATE INDEX [IX_ServiceRecordTasks_MaintenanceTaskId] ON [ServiceRecordTasks] ([MaintenanceTaskId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    CREATE UNIQUE INDEX [IX_ServiceRecordTasks_ServiceRecordId_MaintenanceTaskId] ON [ServiceRecordTasks] ([ServiceRecordId], [MaintenanceTaskId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    ALTER TABLE [OdometerReadings] ADD CONSTRAINT [FK_OdometerReadings_ServiceRecords_ServiceRecordId] FOREIGN KEY ([ServiceRecordId]) REFERENCES [ServiceRecords] ([Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015041218_AddServiceRecords'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261015041218_AddServiceRecords', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015142808_AddServiceItems'
)
BEGIN
    CREATE TABLE [ServiceItems] (
        [Id] uniqueidentifier NOT NULL,
        [ServiceRecordId] uniqueidentifier NOT NULL,
        [Description] nvarchar(100) NOT NULL,
        [Brand] nvarchar(100) NULL,
        [PartNumber] nvarchar(50) NULL,
        [Quantity] decimal(9,2) NOT NULL,
        [UnitCost] decimal(12,2) NOT NULL,
        [IsLabor] bit NOT NULL,
        [SortOrder] int NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ServiceItems] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_ServiceItems_Quantity] CHECK ([Quantity] > 0),
        CONSTRAINT [CK_ServiceItems_UnitCost] CHECK ([UnitCost] >= 0),
        CONSTRAINT [FK_ServiceItems_ServiceRecords_ServiceRecordId] FOREIGN KEY ([ServiceRecordId]) REFERENCES [ServiceRecords] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015142808_AddServiceItems'
)
BEGIN
    CREATE INDEX [IX_ServiceItems_ServiceRecordId] ON [ServiceItems] ([ServiceRecordId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015142808_AddServiceItems'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261015142808_AddServiceItems', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015223145_AddChecklistTemplates'
)
BEGIN
    CREATE TABLE [ChecklistTemplates] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Name] nvarchar(100) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ChecklistTemplates] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ChecklistTemplates_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015223145_AddChecklistTemplates'
)
BEGIN
    CREATE TABLE [ChecklistTemplateItems] (
        [Id] uniqueidentifier NOT NULL,
        [TemplateId] uniqueidentifier NOT NULL,
        [Label] nvarchar(100) NOT NULL,
        [Type] int NOT NULL,
        [Unit] nvarchar(20) NULL,
        [MinValue] decimal(12,2) NULL,
        [MaxValue] decimal(12,2) NULL,
        [SortOrder] int NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ChecklistTemplateItems] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_ChecklistTemplateItems_Range] CHECK ([MinValue] IS NULL OR [MaxValue] IS NULL OR [MinValue] <= [MaxValue]),
        CONSTRAINT [FK_ChecklistTemplateItems_ChecklistTemplates_TemplateId] FOREIGN KEY ([TemplateId]) REFERENCES [ChecklistTemplates] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015223145_AddChecklistTemplates'
)
BEGIN
    CREATE INDEX [IX_ChecklistTemplateItems_TemplateId] ON [ChecklistTemplateItems] ([TemplateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015223145_AddChecklistTemplates'
)
BEGIN
    CREATE INDEX [IX_ChecklistTemplates_UserId] ON [ChecklistTemplates] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261015223145_AddChecklistTemplates'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261015223145_AddChecklistTemplates', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE TABLE [VehicleChecklists] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [TemplateId] uniqueidentifier NOT NULL,
        [IntervalKm] int NULL,
        [IntervalDays] int NULL,
        [IsEnabled] bit NOT NULL,
        [LastRunOdometerKm] decimal(12,2) NOT NULL,
        [LastRunDate] date NOT NULL,
        [StartDate] date NOT NULL,
        [StartOdometerKm] decimal(12,2) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_VehicleChecklists] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_VehicleChecklists_ChecklistTemplates_TemplateId] FOREIGN KEY ([TemplateId]) REFERENCES [ChecklistTemplates] ([Id]),
        CONSTRAINT [FK_VehicleChecklists_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE TABLE [ChecklistRuns] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleChecklistId] uniqueidentifier NOT NULL,
        [RunAt] date NOT NULL,
        [OdometerKm] decimal(12,2) NOT NULL,
        [Notes] nvarchar(1000) NULL,
        [OdometerReadingId] uniqueidentifier NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ChecklistRuns] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ChecklistRuns_OdometerReadings_OdometerReadingId] FOREIGN KEY ([OdometerReadingId]) REFERENCES [OdometerReadings] ([Id]),
        CONSTRAINT [FK_ChecklistRuns_VehicleChecklists_VehicleChecklistId] FOREIGN KEY ([VehicleChecklistId]) REFERENCES [VehicleChecklists] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE TABLE [ChecklistRunItems] (
        [Id] uniqueidentifier NOT NULL,
        [RunId] uniqueidentifier NOT NULL,
        [TemplateItemId] uniqueidentifier NULL,
        [LabelSnapshot] nvarchar(100) NOT NULL,
        [Type] int NOT NULL,
        [Unit] nvarchar(20) NULL,
        [MinValue] decimal(12,2) NULL,
        [MaxValue] decimal(12,2) NULL,
        [SortOrder] int NOT NULL,
        [BoolValue] bit NULL,
        [NumberValue] decimal(12,2) NULL,
        [TextValue] nvarchar(500) NULL,
        [IsFlagged] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ChecklistRunItems] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ChecklistRunItems_ChecklistRuns_RunId] FOREIGN KEY ([RunId]) REFERENCES [ChecklistRuns] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_ChecklistRunItems_ChecklistTemplateItems_TemplateItemId] FOREIGN KEY ([TemplateItemId]) REFERENCES [ChecklistTemplateItems] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE INDEX [IX_ChecklistRunItems_RunId] ON [ChecklistRunItems] ([RunId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE INDEX [IX_ChecklistRunItems_TemplateItemId] ON [ChecklistRunItems] ([TemplateItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE INDEX [IX_ChecklistRuns_OdometerReadingId] ON [ChecklistRuns] ([OdometerReadingId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE INDEX [IX_ChecklistRuns_VehicleChecklistId_RunAt] ON [ChecklistRuns] ([VehicleChecklistId], [RunAt] DESC);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE INDEX [IX_VehicleChecklists_TemplateId] ON [VehicleChecklists] ([TemplateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    CREATE UNIQUE INDEX [IX_VehicleChecklists_VehicleId_TemplateId] ON [VehicleChecklists] ([VehicleId], [TemplateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016015122_AddChecklistRuns'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261016015122_AddChecklistRuns', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016031303_AddIssues'
)
BEGIN
    CREATE TABLE [Issues] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [Title] nvarchar(100) NOT NULL,
        [Description] nvarchar(1000) NULL,
        [Status] int NOT NULL,
        [SourceRunItemId] uniqueidentifier NULL,
        [ResolvedAt] date NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Issues] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Issues_ResolvedAt] CHECK (([Status] = 0 AND [ResolvedAt] IS NULL) OR ([Status] = 1 AND [ResolvedAt] IS NOT NULL)),
        CONSTRAINT [FK_Issues_ChecklistRunItems_SourceRunItemId] FOREIGN KEY ([SourceRunItemId]) REFERENCES [ChecklistRunItems] ([Id]),
        CONSTRAINT [FK_Issues_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016031303_AddIssues'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Issues_SourceRunItemId] ON [Issues] ([SourceRunItemId]) WHERE [SourceRunItemId] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016031303_AddIssues'
)
BEGIN
    CREATE INDEX [IX_Issues_VehicleId] ON [Issues] ([VehicleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016031303_AddIssues'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261016031303_AddIssues', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016074103_LowThreeConcurrency'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261016074103_LowThreeConcurrency', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016081611_ServiceRecordUpdatedAtToken'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261016081611_ServiceRecordUpdatedAtToken', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    CREATE TABLE [TireSets] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Brand] nvarchar(50) NOT NULL,
        [Model] nvarchar(50) NULL,
        [Size] nvarchar(30) NULL,
        [Season] int NOT NULL,
        [PurchaseDate] date NULL,
        [DotCode] nvarchar(20) NULL,
        [Notes] nvarchar(1000) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireSets] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_TireSets_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    CREATE TABLE [TireMounts] (
        [Id] uniqueidentifier NOT NULL,
        [TireSetId] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [MountedAt] date NOT NULL,
        [MountOdometerKm] decimal(12,2) NOT NULL,
        [UnmountedAt] date NULL,
        [UnmountOdometerKm] decimal(12,2) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireMounts] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_TireMounts_Unmount] CHECK (([UnmountedAt] IS NULL AND [UnmountOdometerKm] IS NULL) OR ([UnmountedAt] >= [MountedAt] AND [UnmountOdometerKm] >= [MountOdometerKm])),
        CONSTRAINT [FK_TireMounts_TireSets_TireSetId] FOREIGN KEY ([TireSetId]) REFERENCES [TireSets] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_TireMounts_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    CREATE INDEX [IX_TireMounts_TireSetId_MountedAt] ON [TireMounts] ([TireSetId], [MountedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_TireMounts_TireSetId_Open] ON [TireMounts] ([TireSetId]) WHERE [UnmountedAt] IS NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    CREATE INDEX [IX_TireMounts_VehicleId_MountedAt] ON [TireMounts] ([VehicleId], [MountedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_TireMounts_VehicleId_Open] ON [TireMounts] ([VehicleId]) WHERE [UnmountedAt] IS NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    CREATE INDEX [IX_TireSets_UserId] ON [TireSets] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261016083205_AddTires'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261016083205_AddTires', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017054806_AddTireMeasurements'
)
BEGIN
    CREATE TABLE [TireChecks] (
        [Id] uniqueidentifier NOT NULL,
        [TireMountId] uniqueidentifier NOT NULL,
        [MeasuredAt] date NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireChecks] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_TireChecks_TireMounts_TireMountId] FOREIGN KEY ([TireMountId]) REFERENCES [TireMounts] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017054806_AddTireMeasurements'
)
BEGIN
    CREATE TABLE [TireRotations] (
        [Id] uniqueidentifier NOT NULL,
        [TireMountId] uniqueidentifier NOT NULL,
        [Date] date NOT NULL,
        [OdometerKm] decimal(12,2) NOT NULL,
        [Notes] nvarchar(500) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireRotations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_TireRotations_TireMounts_TireMountId] FOREIGN KEY ([TireMountId]) REFERENCES [TireMounts] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017054806_AddTireMeasurements'
)
BEGIN
    CREATE TABLE [TireMeasurements] (
        [Id] uniqueidentifier NOT NULL,
        [TireCheckId] uniqueidentifier NOT NULL,
        [Position] int NOT NULL,
        [PressureBar] decimal(4,2) NULL,
        [TreadDepthMm] decimal(4,1) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireMeasurements] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_TireMeasurements_Values] CHECK (([PressureBar] IS NOT NULL OR [TreadDepthMm] IS NOT NULL) AND ([PressureBar] IS NULL OR [PressureBar] BETWEEN 0.5 AND 6.0) AND ([TreadDepthMm] IS NULL OR [TreadDepthMm] BETWEEN 0 AND 20)),
        CONSTRAINT [FK_TireMeasurements_TireChecks_TireCheckId] FOREIGN KEY ([TireCheckId]) REFERENCES [TireChecks] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017054806_AddTireMeasurements'
)
BEGIN
    CREATE UNIQUE INDEX [IX_TireChecks_TireMountId_MeasuredAt] ON [TireChecks] ([TireMountId], [MeasuredAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017054806_AddTireMeasurements'
)
BEGIN
    CREATE UNIQUE INDEX [IX_TireMeasurements_TireCheckId_Position] ON [TireMeasurements] ([TireCheckId], [Position]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017054806_AddTireMeasurements'
)
BEGIN
    CREATE INDEX [IX_TireRotations_TireMountId_Date] ON [TireRotations] ([TireMountId], [Date]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017054806_AddTireMeasurements'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261017054806_AddTireMeasurements', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017210832_AddAttachments'
)
BEGIN
    CREATE TABLE [Attachments] (
        [Id] uniqueidentifier NOT NULL,
        [ServiceRecordId] uniqueidentifier NULL,
        [FileUrl] nvarchar(300) NOT NULL,
        [FileName] nvarchar(255) NOT NULL,
        [ContentType] nvarchar(100) NOT NULL,
        [SizeBytes] bigint NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Attachments] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Attachments_ServiceRecords_ServiceRecordId] FOREIGN KEY ([ServiceRecordId]) REFERENCES [ServiceRecords] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017210832_AddAttachments'
)
BEGIN
    CREATE INDEX [IX_Attachments_ServiceRecordId] ON [Attachments] ([ServiceRecordId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017210832_AddAttachments'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261017210832_AddAttachments', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017220918_AddRunAttachments'
)
BEGIN
    ALTER TABLE [Attachments] ADD [ChecklistRunId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017220918_AddRunAttachments'
)
BEGIN
    CREATE INDEX [IX_Attachments_ChecklistRunId] ON [Attachments] ([ChecklistRunId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017220918_AddRunAttachments'
)
BEGIN
    EXEC(N'ALTER TABLE [Attachments] ADD CONSTRAINT [CK_Attachments_OneParent] CHECK (([ServiceRecordId] IS NOT NULL AND [ChecklistRunId] IS NULL) OR ([ServiceRecordId] IS NULL AND [ChecklistRunId] IS NOT NULL))');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017220918_AddRunAttachments'
)
BEGIN
    ALTER TABLE [Attachments] ADD CONSTRAINT [FK_Attachments_ChecklistRuns_ChecklistRunId] FOREIGN KEY ([ChecklistRunId]) REFERENCES [ChecklistRuns] ([Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261017220918_AddRunAttachments'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261017220918_AddRunAttachments', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261018074921_AddReminders'
)
BEGIN
    CREATE TABLE [NotificationRules] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Channel] int NOT NULL,
        [LeadDays] int NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_NotificationRules] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_NotificationRules_LeadDays] CHECK ([LeadDays] BETWEEN 1 AND 365),
        CONSTRAINT [FK_NotificationRules_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261018074921_AddReminders'
)
BEGIN
    CREATE TABLE [Notifications] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [Kind] int NOT NULL,
        [RefId] uniqueidentifier NOT NULL,
        [SentAt] datetimeoffset NULL,
        [SnoozedUntil] date NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Notifications] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Notifications_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261018074921_AddReminders'
)
BEGIN
    CREATE TABLE [VehicleDocuments] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [Type] int NOT NULL,
        [ExpiryDate] date NOT NULL,
        [Cost] decimal(12,2) NULL,
        [Notes] nvarchar(1000) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_VehicleDocuments] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_VehicleDocuments_Cost] CHECK ([Cost] IS NULL OR [Cost] >= 0),
        CONSTRAINT [FK_VehicleDocuments_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261018074921_AddReminders'
)
BEGIN
    CREATE UNIQUE INDEX [IX_NotificationRules_UserId_Channel] ON [NotificationRules] ([UserId], [Channel]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261018074921_AddReminders'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Notifications_UserId_Kind_RefId] ON [Notifications] ([UserId], [Kind], [RefId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261018074921_AddReminders'
)
BEGIN
    CREATE INDEX [IX_VehicleDocuments_VehicleId_ExpiryDate] ON [VehicleDocuments] ([VehicleId], [ExpiryDate]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261018074921_AddReminders'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261018074921_AddReminders', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261024132337_OdometerClientRequestId'
)
BEGIN
    ALTER TABLE [OdometerReadings] ADD [ClientRequestId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261024132337_OdometerClientRequestId'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_OdometerReadings_VehicleId_ClientRequestId] ON [OdometerReadings] ([VehicleId], [ClientRequestId]) WHERE [ClientRequestId] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261024132337_OdometerClientRequestId'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261024132337_OdometerClientRequestId', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261030125930_AddGoogleSubject'
)
BEGIN
    ALTER TABLE [Users] ADD [GoogleSubject] nvarchar(255) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261030125930_AddGoogleSubject'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Users_GoogleSubject] ON [Users] ([GoogleSubject]) WHERE [GoogleSubject] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261030125930_AddGoogleSubject'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261030125930_AddGoogleSubject', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261102185844_AddEmailDigest'
)
BEGIN
    ALTER TABLE [NotificationRules] ADD [IsEnabled] bit NOT NULL DEFAULT CAST(1 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261102185844_AddEmailDigest'
)
BEGIN
    ALTER TABLE [NotificationRules] ADD [LastSentOn] date NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261102185844_AddEmailDigest'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261102185844_AddEmailDigest', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'PK_TireSets', N'PK_Legacy_TireSets', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'FK_TireSets_Users_UserId', N'FK_Legacy_TireSets_Users_UserId', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'[TireSets]', N'Legacy_TireSets', 'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'PK_TireMounts', N'PK_Legacy_TireMounts', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'FK_TireMounts_TireSets_TireSetId', N'FK_Legacy_TireMounts_TireSets_TireSetId', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'FK_TireMounts_Vehicles_VehicleId', N'FK_Legacy_TireMounts_Vehicles_VehicleId', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'CK_TireMounts_Unmount', N'CK_Legacy_TireMounts_Unmount', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'[TireMounts]', N'Legacy_TireMounts', 'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'PK_TireChecks', N'PK_Legacy_TireChecks', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'FK_TireChecks_TireMounts_TireMountId', N'FK_Legacy_TireChecks_TireMounts_TireMountId', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'[TireChecks]', N'Legacy_TireChecks', 'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'PK_TireMeasurements', N'PK_Legacy_TireMeasurements', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'FK_TireMeasurements_TireChecks_TireCheckId', N'FK_Legacy_TireMeasurements_TireChecks_TireCheckId', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'CK_TireMeasurements_Values', N'CK_Legacy_TireMeasurements_Values', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'[TireMeasurements]', N'Legacy_TireMeasurements', 'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'PK_TireRotations', N'PK_Legacy_TireRotations', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'FK_TireRotations_TireMounts_TireMountId', N'FK_Legacy_TireRotations_TireMounts_TireMountId', N'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC sp_rename N'[TireRotations]', N'Legacy_TireRotations', 'OBJECT';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE TABLE [Tires] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [Position] int NOT NULL,
        [Brand] nvarchar(50) NOT NULL,
        [Model] nvarchar(50) NULL,
        [Size] nvarchar(30) NULL,
        [Season] int NOT NULL,
        [DotCode] nvarchar(20) NULL,
        [PurchaseDate] date NULL,
        [FittedAt] date NOT NULL,
        [FittedOdometerKm] decimal(12,2) NOT NULL,
        [RemovedAt] date NULL,
        [RemovedOdometerKm] decimal(12,2) NULL,
        [Notes] nvarchar(1000) NULL,
        [ServiceRecordId] uniqueidentifier NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Tires] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Tires_Removal] CHECK (([RemovedAt] IS NULL AND [RemovedOdometerKm] IS NULL) OR ([RemovedAt] >= [FittedAt] AND [RemovedOdometerKm] >= [FittedOdometerKm])),
        CONSTRAINT [FK_Tires_ServiceRecords_ServiceRecordId] FOREIGN KEY ([ServiceRecordId]) REFERENCES [ServiceRecords] ([Id]),
        CONSTRAINT [FK_Tires_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE TABLE [TireMeasurements] (
        [Id] uniqueidentifier NOT NULL,
        [TireId] uniqueidentifier NOT NULL,
        [Position] int NOT NULL,
        [MeasuredAt] date NOT NULL,
        [PressureBar] decimal(4,2) NULL,
        [TreadDepthMm] decimal(4,1) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireMeasurements] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_TireMeasurements_Values] CHECK (([PressureBar] IS NOT NULL OR [TreadDepthMm] IS NOT NULL) AND ([PressureBar] IS NULL OR [PressureBar] BETWEEN 0.5 AND 6.0) AND ([TreadDepthMm] IS NULL OR [TreadDepthMm] BETWEEN 0 AND 20)),
        CONSTRAINT [FK_TireMeasurements_Tires_TireId] FOREIGN KEY ([TireId]) REFERENCES [Tires] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE TABLE [TireRotations] (
        [Id] uniqueidentifier NOT NULL,
        [VehicleId] uniqueidentifier NOT NULL,
        [Date] date NOT NULL,
        [OdometerKm] decimal(12,2) NOT NULL,
        [Notes] nvarchar(500) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireRotations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_TireRotations_Vehicles_VehicleId] FOREIGN KEY ([VehicleId]) REFERENCES [Vehicles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE TABLE [TireRotationMoves] (
        [Id] uniqueidentifier NOT NULL,
        [TireRotationId] uniqueidentifier NOT NULL,
        [TireId] uniqueidentifier NOT NULL,
        [FromPosition] int NOT NULL,
        [ToPosition] int NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_TireRotationMoves] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_TireRotationMoves_TireRotations_TireRotationId] FOREIGN KEY ([TireRotationId]) REFERENCES [TireRotations] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_TireRotationMoves_Tires_TireId] FOREIGN KEY ([TireId]) REFERENCES [Tires] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE UNIQUE INDEX [IX_TireMeasurements_TireId_MeasuredAt] ON [TireMeasurements] ([TireId], [MeasuredAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE INDEX [IX_TireRotations_VehicleId_Date] ON [TireRotations] ([VehicleId], [Date]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE INDEX [IX_TireRotationMoves_TireId] ON [TireRotationMoves] ([TireId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE UNIQUE INDEX [IX_TireRotationMoves_TireRotationId_TireId] ON [TireRotationMoves] ([TireRotationId], [TireId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    CREATE INDEX [IX_Tires_ServiceRecordId] ON [Tires] ([ServiceRecordId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Tires_VehicleId_Position_OnCar] ON [Tires] ([VehicleId], [Position]) WHERE [RemovedAt] IS NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
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
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103174235_TiresPerWheel'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261103174235_TiresPerWheel', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261104175010_DocumentAttachments'
)
BEGIN
    ALTER TABLE [Attachments] DROP CONSTRAINT [CK_Attachments_OneParent];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261104175010_DocumentAttachments'
)
BEGIN
    ALTER TABLE [Attachments] ADD [VehicleDocumentId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261104175010_DocumentAttachments'
)
BEGIN
    CREATE INDEX [IX_Attachments_VehicleDocumentId] ON [Attachments] ([VehicleDocumentId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261104175010_DocumentAttachments'
)
BEGIN
    EXEC(N'ALTER TABLE [Attachments] ADD CONSTRAINT [CK_Attachments_OneParent] CHECK ((CASE WHEN [ServiceRecordId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [ChecklistRunId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [VehicleDocumentId] IS NULL THEN 0 ELSE 1 END) = 1)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261104175010_DocumentAttachments'
)
BEGIN
    ALTER TABLE [Attachments] ADD CONSTRAINT [FK_Attachments_VehicleDocuments_VehicleDocumentId] FOREIGN KEY ([VehicleDocumentId]) REFERENCES [VehicleDocuments] ([Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261104175010_DocumentAttachments'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261104175010_DocumentAttachments', N'10.0.13');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [NameHe] nvarchar(100) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''שמן מנוע ופילטר שמן''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000001'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''פילטר אוויר''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000002'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''פילטר מזגן''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000003'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''בדיקת רפידות בלמים''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000004'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''נוזל בלמים''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000005'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''נוזל קירור''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000006'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''שמן גיר''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000007'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''מצתים''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000008'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''רצועת טיימינג''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000009'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''רוטציית צמיגים''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000010'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''בדיקת מצבר''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000011'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    EXEC(N'UPDATE [TaskTemplates] SET [NameHe] = N''מגבים''
    WHERE [Id] = ''7a5c0000-0000-4000-8000-000000000012'';
    SELECT @@ROWCOUNT');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261106063910_TemplateHebrewNames'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261106063910_TemplateHebrewNames', N'10.0.13');
END;

COMMIT;
GO

