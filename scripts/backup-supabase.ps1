# Backs up the live database (Supabase, schema "onlycars") to a file, then proves it restores (2026-11-08).
# Uses the admin connection in user-secrets (ConnectionStrings:Supabase) and the local Docker container
# onlycars-dev-pg17 for pg_dump and the trial restore. Prints no secrets. Usage: .\scripts\backup-supabase.ps1 [folder]
param([string]$Folder = "$env:USERPROFILE\Documents\OnlyCars-backups")
$ErrorActionPreference = 'Stop'
$proj = Join-Path $PSScriptRoot '..\src\OnlyCars.Api\OnlyCars.Api.csproj'
$box = 'onlycars-dev-pg17'

$line = dotnet user-secrets list --project $proj | Where-Object { $_.StartsWith('ConnectionStrings:Supabase = ') }
if (-not $line) { throw 'ConnectionStrings:Supabase not in user-secrets' }
$c = @{}; foreach ($p in ($line.Substring(29) -split ';')) { $i = $p.IndexOf('='); if ($i -gt 0) { $c[$p.Substring(0, $i).Trim()] = $p.Substring($i + 1) } }

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$name = "onlycars-$stamp.dump"
New-Item -ItemType Directory -Force $Folder | Out-Null
$env:PGHOST = $c['Host']; $env:PGPORT = $c['Port']; $env:PGDATABASE = $c['Database']; $env:PGUSER = $c['Username']; $env:PGPASSWORD = $c['Password']; $env:PGSSLMODE = 'require'
try {
  docker exec -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE $box pg_dump -Fc -n onlycars -f "/tmp/$name"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }
  $live = docker exec -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE $box psql -X -At -c "SELECT count(*) FROM pg_tables WHERE schemaname='onlycars'"
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
docker cp "${box}:/tmp/$name" (Join-Path $Folder $name) | Out-Null
$file = Get-Item (Join-Path $Folder $name)
"Backup: $($file.FullName), $([math]::Round($file.Length / 1KB)) KB, $live tables in the live schema"

# Trial restore into a throwaway local database, then count rows per table.
docker exec $box sh -c "dropdb -U postgres --if-exists restore_check && createdb -U postgres restore_check && pg_restore -U postgres -d restore_check --no-owner --no-privileges /tmp/$name"
if ($LASTEXITCODE -ne 0) { throw "trial restore failed ($LASTEXITCODE)" }
$sql = "SELECT sum(n) || ' rows in ' || count(*) || ' tables' FROM (SELECT (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM onlycars.%I', table_name), false, true, '')))[1]::text::int AS n FROM information_schema.tables WHERE table_schema = 'onlycars' AND table_name <> '__EFMigrationsHistory') t"
"Restored: " + (docker exec $box psql -U postgres -d restore_check -X -At -c $sql)
docker exec $box sh -c "dropdb -U postgres restore_check; rm -f /tmp/$name"
"Trial restore passed and was removed. The backup holds personal data: keep a copy off this PC, somewhere private."
