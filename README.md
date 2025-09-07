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
