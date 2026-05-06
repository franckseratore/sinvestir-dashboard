#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "══════════════════════════════════════════"
echo " Installation — Dashboard S'investir V0"
echo "══════════════════════════════════════════"
echo ""

ERRORS=0

# ─── Python ───────────────────────────────────────
echo "▶  Vérification Python..."
PYTHON=$(which python3 2>/dev/null || true)
if [ -z "$PYTHON" ]; then
  echo "   ❌ Python 3 introuvable. Installe-le depuis python.org"
  ERRORS=$((ERRORS+1))
else
  PYVER=$($PYTHON --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
  echo "   ✅ Python $PYVER trouvé"
fi

# ─── Node.js ──────────────────────────────────────
echo "▶  Vérification Node.js..."
NODE=$(which node 2>/dev/null || true)
if [ -z "$NODE" ]; then
  echo "   ❌ Node.js introuvable. Installe-le depuis nodejs.org (v18+)"
  ERRORS=$((ERRORS+1))
else
  NODEVER=$(node --version)
  echo "   ✅ Node.js $NODEVER trouvé"
fi

# ─── Google Drive Desktop ─────────────────────────
echo "▶  Vérification Google Drive Desktop..."
DRIVE_APP="/Applications/Google Drive.app"
DRIVE_CLOUDSTG="$HOME/Library/CloudStorage/GoogleDrive-"*
DRIVE_LEGACY="$HOME/Google Drive"

if [ -d "$DRIVE_APP" ] || ls $DRIVE_CLOUDSTG 2>/dev/null | head -1 | grep -q "GoogleDrive"; then
  echo "   ✅ Google Drive Desktop installé"

  # Vérifier le mode Mirror
  DRIVE_PATH=$(ls -d $HOME/Library/CloudStorage/GoogleDrive-* 2>/dev/null | head -1)
  if [ -n "$DRIVE_PATH" ]; then
    MON_DRIVE="$DRIVE_PATH/Mon Drive"
    if [ -d "$MON_DRIVE" ]; then
      FILE_COUNT=$(find "$MON_DRIVE" -maxdepth 2 -name "*.xlsx" 2>/dev/null | wc -l | tr -d ' ')
      if [ "$FILE_COUNT" -eq "0" ]; then
        echo "   ⚠️  Drive en mode Stream — les fichiers ne sont pas synchronisés localement."
        echo "      Les fichiers seront lus depuis data/ si disponibles."
      else
        echo "   ✅ Drive en mode Mirror ($FILE_COUNT fichiers xlsx détectés)"
      fi
    fi
  fi
else
  echo "   ⚠️  Google Drive Desktop non détecté."
  echo "      Pour le refresh auto, installe-le depuis drive.google.com/drive/download"
  echo "      et active le mode Mirror pour les dossiers S'investir."
fi

# ─── Fichiers source ──────────────────────────────
echo "▶  Vérification des fichiers source..."

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "   ℹ️  .env créé depuis .env.example. Configure les chemins si nécessaire."
  else
    echo "   ❌ .env.example introuvable"
    ERRORS=$((ERRORS+1))
  fi
else
  echo "   ✅ .env présent"
fi

# Charger le .env pour vérifier les paths
if [ -f ".env" ]; then
  source .env 2>/dev/null || true

  if [ -n "$STATS_FILE_PATH" ] && [ -f "$STATS_FILE_PATH" ]; then
    echo "   ✅ STATS_FILE trouvé: $(basename "$STATS_FILE_PATH")"
  else
    echo "   ⚠️  STATS_FILE non trouvé. Vérifie STATS_FILE_PATH dans .env"
    echo "      Ou place le fichier dans data/"
  fi

  if [ -n "$ADS_FILE_PATH" ] && [ -f "$ADS_FILE_PATH" ]; then
    echo "   ✅ ADS_FILE trouvé: $(basename "$ADS_FILE_PATH")"
  else
    echo "   ⚠️  ADS_FILE non trouvé. Vérifie ADS_FILE_PATH dans .env"
    echo "      Ou place le fichier dans data/"
  fi
fi

# Vérifier le dossier data/ local
if ls data/*.xlsx 2>/dev/null | head -1 | grep -q ".xlsx"; then
  echo "   ✅ Fichiers xlsx dans data/ (fallback local)"
fi

# ─── Python deps ──────────────────────────────────
echo "▶  Installation des dépendances Python..."
python3 -m pip install -r backend/requirements.txt -q
echo "   ✅ Dépendances Python installées"

# ─── Node deps ────────────────────────────────────
if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
  echo "▶  Installation des dépendances Node.js..."
  cd frontend
  npm install --silent
  cd "$ROOT"
  echo "   ✅ Dépendances Node.js installées"
else
  echo "   ⚠️  frontend/ pas encore créé (étape 3)"
fi

# ─── Targets file ─────────────────────────────────
if [ ! -f "targets_2026.xlsx" ]; then
  echo "▶  Création du fichier targets_2026.xlsx (valeurs par défaut)..."
  python3 -c "
import openpyxl
wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'Targets'
headers = ['Indicateur', 'Description', 'Unité', 'Sens', 'Target 2026', 'Target mensuelle', 'Seuil critique', 'Owner']
ws.append(headers)
rows = [
  ('ca_ht', 'CA HT total', '€', 'Haut', 7200000, 600000, 300000, 'Sales'),
  ('volume_leads', 'Volume leads total', 'leads', 'Haut', 180000, 15000, 5000, 'Marketing'),
  ('volume_leads_paid', 'Volume leads Paid', 'leads', 'Haut', 40000, 3333, 1500, 'Marketing'),
  ('cpl_paid', 'CPL Paid global', '€', 'Bas', 15, 15, 30, 'Marketing'),
  ('booking_rate', 'Booking rate global', '%', 'Haut', 0.30, 0.30, 0.15, 'Marketing'),
  ('no_show_rate', 'No-show rate', '%', 'Bas', 0.20, 0.20, 0.40, 'Sales'),
  ('closing_rate', 'Taux de closing', '%', 'Haut', 0.30, 0.30, 0.15, 'Sales'),
  ('acv', 'Panier moyen (ACV)', '€', 'Haut', 1900, 1900, 1000, 'Sales'),
  ('roas_paid', 'ROAS Paid global', 'x', 'Haut', 5, 5, 2, 'Marketing'),
  ('budget_paid', 'Budget Paid total', '€', 'Bas', 420000, 35000, 60000, 'Marketing'),
]
for r in rows:
  ws.append(r)
wb.save('targets_2026.xlsx')
print('targets_2026.xlsx créé')
"
  echo "   ✅ targets_2026.xlsx créé (ajuste les valeurs selon tes objectifs 2026)"
else
  echo "   ✅ targets_2026.xlsx déjà présent"
fi

# ─── Résumé ───────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
  echo " ✅ Installation terminée"
  echo ""
  echo " Pour démarrer le dashboard :"
  echo "   bash scripts/start.sh"
else
  echo " ⚠️  Installation terminée avec $ERRORS erreur(s)"
  echo " Résous les erreurs ci-dessus avant de démarrer."
fi
echo "══════════════════════════════════════════"
