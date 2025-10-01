# ---------- Build stage ----------
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy the project and solution files and restore dependencies
COPY PuzzleAM.sln .
COPY PuzzleAM/*.csproj PuzzleAM/
COPY PuzzleAM.Model/*.csproj PuzzleAM.Model/
COPY PuzzleAM.View/*.csproj PuzzleAM.View/
COPY PuzzleAM.ViewServices/*.csproj PuzzleAM.ViewServices/
COPY PuzzleAM.Tests/*.csproj PuzzleAM.Tests/
RUN dotnet restore PuzzleAM.sln

# Copy the rest of the source and publish
COPY . .
RUN dotnet publish -c Release -o /app/out

# ---------- Runtime stage ----------
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app

# Expose port 8080 and configure the default database provider
EXPOSE 8080
ARG DATABASE_PROVIDER=Sqlite
ENV Database__Provider=$DATABASE_PROVIDER

# Copy published output and the entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
COPY --from=build /app/out .

# Run the application through the entrypoint script so it respects the PORT environment variable
ENTRYPOINT ["./docker-entrypoint.sh"]
