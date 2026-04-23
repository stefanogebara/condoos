#!/usr/bin/env bash
# One-shot setup for a fresh clone of CondoOS.
# Installs deps, copies .env, seeds the SQLite DB.
# Usage:   bash scripts/setup.sh

set -euo pipefail

echo ""
echo "CondoOS — local setup"
echo "---------------------"

# 1. Env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[1/4] Created .env from .env.example"
  echo "      -> Add your OpenRouter key (optional — falls back to canned AI)"
else
  echo "[1/4] .env already exists — leaving untouched"
fi

# 2. Root deps (concurrently)
echo "[2/4] Installing root dev deps..."
npm install --silent 2>&1 | tail -3

# 3. Server deps (better-sqlite3 builds native)
echo "[3/4] Installing server deps (builds better-sqlite3 native module)..."
npm --prefix server install --silent 2>&1 | tail -3

# 4. Client deps (Vite + React)
echo "[4/4] Installing client deps..."
npm --prefix client-app install --silent 2>&1 | tail -3

# 5. Seed
echo ""
echo "Seeding demo data..."
npm run seed 2>&1 | tail -5

echo ""
echo "All set. Run:     npm run dev"
echo "Then open:        http://localhost:3000"
echo ""
echo "Demo accounts:"
echo "  admin@condoos.dev    / admin123    (board admin)"
echo "  resident@condoos.dev / resident123 (resident)"
echo ""
