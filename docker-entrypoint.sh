#!/bin/sh
set -e

PORT="${PORT:-8080}"

exec dotnet PuzzleAM.dll --urls "http://0.0.0.0:${PORT}"
