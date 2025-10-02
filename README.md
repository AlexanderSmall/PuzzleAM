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

   The application also recognises simplified environment variables such as `DATABASE_PROVIDER` and
   `DATABASE_CONNECTION_STRING`, which can be helpful on platforms that do not support hierarchical
   configuration keys.

3. Supported provider values are:

   - `Sqlite` (default) – stores data in a SQLite database file. The application will create a per-user data directory when needed.
     If it cannot create that directory (for example, due to read-only storage), the database file falls back to
     `%TEMP%/PuzzleAM/<database file>` so it can still operate in environments with limited permissions.
   - `Postgres`, `PostgreSQL`, or `Npgsql` – uses the Npgsql Entity Framework Core provider to connect to PostgreSQL-compatible
     databases such as Cloud SQL for PostgreSQL.

After updating configuration, run `dotnet ef database update` (or restart the application) to ensure migrations are applied to
the configured database.

## Container deployment

The Docker image now reads the `PORT` environment variable when starting the application. Most platforms (including Cloud Run,
Render, and Heroku-style services) inject this variable automatically. When `PORT` is not set the container listens on
`8080`, matching the Dockerfile's exposed port. You no longer need to override `ASPNETCORE_URLS` manually; instead set
`PORT` if your hosting environment requires a different listener port.

When building the container you can now choose the database provider through the `DATABASE_PROVIDER` build argument. It
defaults to `Sqlite`, but setting it ensures production images contain the correct configuration. For example, Google Cloud
Build uses the `cloudbuild.yaml` file in this repository to build and deploy the image with PostgreSQL enabled:

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions _CONNECTION_STRING="Host=/cloudsql/PROJECT:REGION:INSTANCE;Database=puzzledb;Username=postgres;Password=CHANGE_ME"
```

The Cloud Build configuration passes `DATABASE_PROVIDER=Postgres` to `docker build` and deploys to Cloud Run with the
following environment variables:

```text
Database__Provider=Postgres
ConnectionStrings__DefaultConnection=<your PostgreSQL connection string>
```

If you deploy with `gcloud run deploy` manually, be sure to include the same environment variables:

```bash
gcloud run deploy puzzleam \
  --image gcr.io/PROJECT/puzzleam \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars Database__Provider=Postgres,ConnectionStrings__DefaultConnection="<your PostgreSQL connection string>"
```
