#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🚀 Démarrage du Dashboard S'investir..."

# Vérification du .env
if [ ! -f ".env" ]; then
  echo "❌ Fichier .env introuvable. Lance: cp .env.example .env puis configure les chemins."
  exit 1
fi

# Kill les ports s'ils sont déjà utilisés
kill $(lsof -ti:8000) 2>/dev/null && echo "   Port 8000 libéré" || true
kill $(lsof -ti:3000) 2>/dev/null && echo "   Port 3000 libéré" || true

# Backend
echo ""
echo "▶  Backend (port 8000)..."
python3 -m uvicorn backend.app.main:app --port 8000 --log-level warning > /tmp/sinvestir-backend.log 2>&1 &
BACKEND_PID=$!

# Attendre que le backend soit prêt
echo "   Chargement des données Excel (peut prendre 15-30s)..."
for i in $(seq 1 40); do
  sleep 2
  if curl -s http://localhost:8000/ > /dev/null 2>&1; then
    echo "   ✅ Backend prêt"
    break
  fi
  if [ $i -eq 40 ]; then
    echo "   ❌ Backend n'a pas démarré. Voir /tmp/sinvestir-backend.log"
    cat /tmp/sinvestir-backend.log | tail -20
    exit 1
  fi
done

# Frontend
echo ""
echo "▶  Frontend (port 3000)..."
cd frontend
npm run dev > /tmp/sinvestir-frontend.log 2>&1 &
FRONTEND_PID=$!
cd "$ROOT"

# Attendre que le frontend soit prêt
echo "   Compilation Next.js..."
for i in $(seq 1 30); do
  sleep 2
  if curl -s http://localhost:3000/ > /dev/null 2>&1; then
    echo "   ✅ Frontend prêt"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "   ❌ Frontend n'a pas démarré. Voir /tmp/sinvestir-frontend.log"
    exit 1
  fi
done

echo ""
echo "✅ Dashboard disponible sur http://localhost:3000"
echo ""
echo "   Backend PID: $BACKEND_PID  | Logs: /tmp/sinvestir-backend.log"
echo "   Frontend PID: $FRONTEND_PID | Logs: /tmp/sinvestir-frontend.log"
echo ""
echo "   Pour arrêter: kill $BACKEND_PID $FRONTEND_PID"
echo ""

# Ouvrir le navigateur
open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

# Garder le script actif
wait $BACKEND_PID $FRONTEND_PID
