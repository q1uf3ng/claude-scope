#!/usr/bin/env bash
# Prepare a clean release folder for GitHub publishing.
# Usage: bash scripts/prepare-release.sh

set -e

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$PROJ_ROOT/release/claude-scope"

echo "=== ClaudeScope Release Builder ==="
echo ""

# Clean previous release
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Build first
echo "[1/4] Building project..."
cd "$PROJ_ROOT"
pnpm build

# Run tests
echo "[2/4] Running tests..."
pnpm test

echo "[3/4] Copying files..."

# Copy root files
cp "$PROJ_ROOT/package.json" "$RELEASE_DIR/"
cp "$PROJ_ROOT/pnpm-workspace.yaml" "$RELEASE_DIR/"
cp "$PROJ_ROOT/pnpm-lock.yaml" "$RELEASE_DIR/"
cp "$PROJ_ROOT/tsconfig.base.json" "$RELEASE_DIR/"
cp "$PROJ_ROOT/README.md" "$RELEASE_DIR/"
cp "$PROJ_ROOT/LICENSE" "$RELEASE_DIR/"
cp "$PROJ_ROOT/CLAUDE.md" "$RELEASE_DIR/"
cp "$PROJ_ROOT/.gitignore" "$RELEASE_DIR/"

# Copy assets
if [ -d "$PROJ_ROOT/assets" ]; then
  cp -r "$PROJ_ROOT/assets" "$RELEASE_DIR/assets"
fi

# Copy packages (source only, no dist/node_modules)
for pkg in proxy sdk ui; do
  pkg_dir="$RELEASE_DIR/packages/$pkg"
  mkdir -p "$pkg_dir/src"

  # Copy source files
  cp -r "$PROJ_ROOT/packages/$pkg/src/"* "$pkg_dir/src/"

  # Copy package config files
  cp "$PROJ_ROOT/packages/$pkg/package.json" "$pkg_dir/"
  cp "$PROJ_ROOT/packages/$pkg/tsconfig.json" "$pkg_dir/"

  # Copy tsup config if exists
  [ -f "$PROJ_ROOT/packages/$pkg/tsup.config.ts" ] && cp "$PROJ_ROOT/packages/$pkg/tsup.config.ts" "$pkg_dir/"

  # Copy vite config if exists (UI)
  [ -f "$PROJ_ROOT/packages/$pkg/vite.config.ts" ] && cp "$PROJ_ROOT/packages/$pkg/vite.config.ts" "$pkg_dir/"

  # Copy tailwind config if exists (UI)
  [ -f "$PROJ_ROOT/packages/$pkg/tailwind.config.js" ] && cp "$PROJ_ROOT/packages/$pkg/tailwind.config.js" "$pkg_dir/"

  # Copy postcss config if exists (UI)
  [ -f "$PROJ_ROOT/packages/$pkg/postcss.config.js" ] && cp "$PROJ_ROOT/packages/$pkg/postcss.config.js" "$pkg_dir/"

  # Copy index.html if exists (UI)
  [ -f "$PROJ_ROOT/packages/$pkg/index.html" ] && cp "$PROJ_ROOT/packages/$pkg/index.html" "$pkg_dir/"
done

# Copy test files
mkdir -p "$RELEASE_DIR/packages/proxy/test"
cp "$PROJ_ROOT/packages/proxy/test/integration.test.mjs" "$RELEASE_DIR/packages/proxy/test/"

# Copy scripts
mkdir -p "$RELEASE_DIR/scripts"
cp "$PROJ_ROOT/scripts/prepare-release.sh" "$RELEASE_DIR/scripts/"

echo "[4/4] Verifying release..."

# Count files
FILE_COUNT=$(find "$RELEASE_DIR" -type f | wc -l)
echo ""
echo "=== Release Ready ==="
echo "Location: $RELEASE_DIR"
echo "Files: $FILE_COUNT"
echo ""
echo "Contents:"
find "$RELEASE_DIR" -type f | sed "s|$RELEASE_DIR/||" | sort
echo ""
echo "To publish to GitHub:"
echo "  cd $RELEASE_DIR"
echo "  git init"
echo "  git add ."
echo "  git commit -m 'Initial release v0.1.0'"
echo "  git remote add origin https://github.com/YOUR_USERNAME/claude-scope.git"
echo "  git push -u origin main"
