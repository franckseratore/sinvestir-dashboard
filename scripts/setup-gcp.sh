#!/bin/bash
set -e

PROJECT_ID="sinvestir-dashboard-2026"
REPO="franckseratore/sinvestir-dashboard"
REGION="europe-west1"
SA_EMAIL="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"

echo "→ Activation des APIs..."
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com --project=$PROJECT_ID -q

echo "→ Artifact Registry..."
gcloud artifacts repositories create sinvestir --repository-format=docker --location=$REGION --project=$PROJECT_ID -q 2>/dev/null || true

echo "→ Service Account..."
gcloud iam service-accounts create github-deploy --display-name="GitHub Deploy" --project=$PROJECT_ID -q 2>/dev/null || true

echo "→ Permissions..."
for ROLE in roles/run.admin roles/artifactregistry.admin roles/storage.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="$ROLE" -q
done

echo "→ Workload Identity Federation..."
gcloud iam workload-identity-pools create github-pool --location=global --project=$PROJECT_ID -q 2>/dev/null || true
POOL=$(gcloud iam workload-identity-pools describe github-pool --location=global --project=$PROJECT_ID --format="value(name)")
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --workload-identity-pool=github-pool --location=global \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --project=$PROJECT_ID -q 2>/dev/null || true

echo "→ Binding GitHub → SA..."
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL/attribute.repository/$REPO" \
  --project=$PROJECT_ID -q

echo ""
echo "✅ Setup terminé. Copie ces 2 valeurs dans Claude :"
echo ""
echo "WIF_PROVIDER=$POOL/providers/github-provider"
echo "WIF_SERVICE_ACCOUNT=$SA_EMAIL"
