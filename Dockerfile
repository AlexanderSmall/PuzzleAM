# ---------- Build stage ----------
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy the project file and restore dependencies
COPY *.csproj ./
RUN dotnet restore

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
