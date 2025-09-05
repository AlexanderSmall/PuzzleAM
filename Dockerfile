# ---------- Build stage ----------
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy the project and solution files and restore dependencies
COPY PuzzleAM.sln .
COPY PuzzleAM/*.csproj PuzzleAM/
COPY PuzzleAM.Model/*.csproj PuzzleAM.Model/
COPY PuzzleAM.View/*.csproj PuzzleAM.View/
COPY PuzzleAM.ViewServices/*.csproj PuzzleAM.ViewServices/
RUN dotnet restore PuzzleAM.sln

# Copy the rest of the source and publish
COPY . .
RUN dotnet publish -c Release -o /app/out

# ---------- Runtime stage ----------
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app

# Expose port 8080 and configure Kestrel to listen on all interfaces
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

# Copy published output and start the application
COPY --from=build /app/out .
ENTRYPOINT ["dotnet", "PuzzleAM.dll"]
