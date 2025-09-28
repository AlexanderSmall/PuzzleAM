# PuzzleAM

This project uses [Heroicons](https://heroicons.com/) for navigation icons.

## Adding icons

1. Download the desired SVG from the Heroicons repository or website.
2. Place the file under `PuzzleAM/wwwroot/lib/heroicons`.
3. Reference the icon in a Razor component with:
   ```razor
   <img src="/lib/heroicons/your-icon.svg" />
   ```

Icons are sized automatically in the navigation menu via CSS. Adjust styles as needed for other locations.

## Database configuration

The application supports multiple Entity Framework Core providers. By default it runs against a local SQLite file, but you can
change the provider and connection string without modifying the code.

1. Set the provider name in configuration using the `Database:Provider` key. For JSON files this looks like:

   ```json
   {
     "Database": {
       "Provider": "Sqlite"
     },
     "ConnectionStrings": {
       "DefaultConnection": "Data Source=app.db"
     }
   }
   ```

2. When deploying, provide the same settings through environment variables. For example:

   ```bash
   export Database__Provider=Npgsql
   export ConnectionStrings__DefaultConnection="Host=localhost;Database=puzzledb;Username=postgres;Password=secret"
   ```

3. Supported provider values are:

   - `Sqlite` (default) – stores data in a SQLite database file. The application will create a per-user data directory when needed.
   - `Postgres`, `PostgreSQL`, or `Npgsql` – uses the Npgsql Entity Framework Core provider to connect to PostgreSQL-compatible
     databases such as Cloud SQL for PostgreSQL.

After updating configuration, run `dotnet ef database update` (or restart the application) to ensure migrations are applied to
the configured database.

## Container deployment

The Docker image now reads the `PORT` environment variable when starting the application. Most platforms (including Cloud Run,
Render, and Heroku-style services) inject this variable automatically. When `PORT` is not set the container listens on
`8080`, matching the Dockerfile's exposed port. You no longer need to override `ASPNETCORE_URLS` manually; instead set
`PORT` if your hosting environment requires a different listener port.
