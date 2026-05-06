#!/bin/bash
set -e

PROJECT_ID="sinvestir-dashboard-2026"
POOL_ID="github-pool"
PROVIDER_ID="github-provider"
REGION="europe-west1"

echo "Activation des APIs..."
gcloud services enable iamcredentials.googleapis.com --project=$PROJECT_ID
gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID
gcloud services enable run.googleapis.com --project=$PROJECT_ID
echo "APIs activées."

echo ""
echo "Création du repo Artifact Registry..."
gcloud artifacts repositories create sinvestir \
  --repository-format=docker \
  --location=$REGION \
  --project=$PROJECT_ID \
  --description="S'investir Dashboard images" 2>/dev/null || echo "Repo déjà existant."

echo ""
echo "Création du provider WIF (si pas déjà fait)..."
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-condition="attribute.repository == 'franckseratore/sinvestir-dashboard'" \
  2>/dev/null || echo "Provider déjà existant."

echo ""
echo "Tout est prêt !"
