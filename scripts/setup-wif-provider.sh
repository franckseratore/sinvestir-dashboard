#!/bin/bash
set -e

PROJECT_ID="sinvestir-dashboard-2026"
POOL_ID="github-pool"
PROVIDER_ID="github-provider"

echo "Création du provider WIF..."

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

echo ""
echo "Provider créé avec succès !"
