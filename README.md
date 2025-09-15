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

The application uses Entity Framework Core with SQLite. The default connection string (`DefaultConnection`) points to `/data/puzzleam/app.db` so the database can live on a persistent volume. Override this value as needed via the `ConnectionStrings__DefaultConnection` environment variable when running locally or in production.

## Applying migrations

EF Core migrations are checked into the repository. Apply them whenever the application is deployed:

```bash
dotnet ef database update
```

When making schema changes, create a new migration (for example `dotnet ef migrations add AddSomeFeature`) and commit it alongside the code change.

## Docker deployment

When running the published container image, mount a named volume at `/data/puzzleam` to preserve the SQLite database between image updates:

```bash
docker run --rm -p 8080:8080 -v puzzleam-data:/data/puzzleam <your-image>
```

Run `dotnet ef database update` (or equivalent) as part of your deployment process before starting the app so that the migrations are applied to the mounted database.
