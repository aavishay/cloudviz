#!/bin/bash
set -e

# --- Configuration ---
ROOT_DIR=$(pwd)
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
BINARY_NAME="cloudviz"

# --- Build Process ---

echo "🚀 Building CloudViz..."

# 1. Build Frontend
echo "📦 Building frontend..."
cd "$FRONTEND_DIR"
npm install
npm run build

# 2. Prepare Backend Assets
echo "📂 Syncing assets to backend..."
rm -rf "$BACKEND_DIR/dist"
cp -r "$FRONTEND_DIR/dist" "$BACKEND_DIR/dist"

# 3. Build Backend CLI
echo "🏗️  Building backend CLI..."
cd "$BACKEND_DIR"
go build -o "$BINARY_NAME" .

echo "✅ Build complete! You can now run the CLI from the backend directory:"
echo "   cd backend && ./$BINARY_NAME serve"
