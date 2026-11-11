#!/usr/bin/env bash
# One-time Google Cloud setup for Scopit Community. Run it in Cloud Shell
# (https://shell.cloud.google.com) after creating a project with billing:
#
#   gcloud config set project YOUR_PROJECT_ID
#   curl -fsSLO https://raw.githubusercontent.com/smj9504/scopit/main/community/deploy/gcp-setup.sh
#   bash gcp-setup.sh
#
# It creates, in that project:
#   - the VM: e2-micro in us-east1-b with a 30 GB standard disk (Google's
#     always-free size), Debian 12, a static IP, and ports 80 and 443 open
#   - daily snapshots of the VM's disk, kept 7 days
#   - a storage bucket the releases are uploaded to
#   - the community admin's email and a generated password in Secret Manager
#   - a keyless link (workload identity federation) that lets GitHub Actions
#     in smj9504/scopit, main branch only, upload releases and read those
#     secrets
# Safe to re-run: anything that exists is left as it is.
set -euo pipefail

REPO=smj9504/scopit
REF=${REF:-main}
REGION=us-east1
ZONE=us-east1-b
VM=scopit-community
DOMAIN=community.scopit.work

PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT" ]; then
  echo "Choose the project first: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
BUCKET=$PROJECT-scopit-community
VM_SA=community-vm@$PROJECT.iam.gserviceaccount.com
DEPLOY_SA=community-deploy@$PROJECT.iam.gserviceaccount.com

exists() { "$@" >/dev/null 2>&1; }
# New service accounts take a few seconds to become usable in IAM policies.
retry() { for _ in 1 2 3 4 5 6 7 8; do "$@" >/dev/null 2>&1 && return 0; sleep 10; done; "$@"; }
step() { printf '\n== %s\n' "$*"; }

echo "Project: $PROJECT ($NUMBER)"

step "Turning on the APIs"
gcloud services enable compute.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

step "Admin login (Secret Manager)"
if ! exists gcloud secrets describe community-admin-email; then
  read -rp "Email address for the community admin account: " admin_email
  printf '%s' "$admin_email" | gcloud secrets create community-admin-email --data-file=- --replication-policy=automatic
fi
if ! exists gcloud secrets describe community-admin-password; then
  admin_password=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | cut -c1-24)
  printf '%s' "$admin_password" | gcloud secrets create community-admin-password --data-file=- --replication-policy=automatic
  echo "Admin password (save it in your password manager; it is also in Secret Manager):"
  echo "  $admin_password"
fi

step "Release bucket"
exists gcloud storage buckets describe "gs://$BUCKET" ||
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention

step "Service accounts"
exists gcloud iam service-accounts describe "$VM_SA" ||
  gcloud iam service-accounts create community-vm --display-name="Scopit Community VM"
exists gcloud iam service-accounts describe "$DEPLOY_SA" ||
  gcloud iam service-accounts create community-deploy --display-name="Scopit Community deploys (GitHub Actions)"

# The VM reads releases and, at first install, the admin login.
retry gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$VM_SA" --role=roles/storage.objectViewer
for secret in community-admin-email community-admin-password; do
  retry gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$VM_SA" --role=roles/secretmanager.secretAccessor
done

# GitHub Actions uploads releases, reads the secrets to apply settings, and
# can restart the VM or read its console when a release does not come up.
retry gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/storage.objectAdmin
for role in roles/secretmanager.secretAccessor roles/compute.instanceAdmin.v1; do
  retry gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$DEPLOY_SA" --role="$role" --condition=None
done
retry gcloud iam service-accounts add-iam-policy-binding "$VM_SA" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser

step "GitHub Actions link (main branch of $REPO only)"
exists gcloud iam workload-identity-pools describe github --location=global ||
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
exists gcloud iam workload-identity-pools providers describe scopit --location=global --workload-identity-pool=github ||
  gcloud iam workload-identity-pools providers create-oidc scopit --location=global \
    --workload-identity-pool=github --display-name="$REPO (main)" \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
    --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main'"
retry gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

step "Network"
exists gcloud compute networks describe default || gcloud compute networks create default --subnet-mode=auto
exists gcloud compute firewall-rules describe community-web ||
  gcloud compute firewall-rules create community-web --network=default \
    --allow=tcp:80,tcp:443 --target-tags=community-web --source-ranges=0.0.0.0/0
exists gcloud compute addresses describe community-ip --region="$REGION" ||
  gcloud compute addresses create community-ip --region="$REGION"
IP=$(gcloud compute addresses describe community-ip --region="$REGION" --format='value(address)')

step "Daily disk snapshots"
exists gcloud compute resource-policies describe community-daily --region="$REGION" ||
  gcloud compute resource-policies create snapshot-schedule community-daily --region="$REGION" \
    --daily-schedule --start-time=08:00 --max-retention-days=7 \
    --on-source-disk-delete=keep-auto-snapshots --storage-location="$REGION"

step "VM"
if ! exists gcloud compute instances describe "$VM" --zone="$ZONE"; then
  startup=$(mktemp)
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$REF/community/deploy/vm-startup.sh" -o "$startup"
  gcloud compute instances create "$VM" --zone="$ZONE" --machine-type=e2-micro \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=30GB --boot-disk-type=pd-standard \
    --address="$IP" --tags=community-web \
    --service-account="$VM_SA" --scopes=cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata="community-bucket=$BUCKET,community-domain=$DOMAIN" \
    --metadata-from-file=startup-script="$startup"
fi
gcloud compute disks add-resource-policies "$VM" --zone="$ZONE" --resource-policies=community-daily >/dev/null 2>&1 || true

cat <<EOF

Done.

1. DNS: scopit.work's DNS is at Namecheap. Domain List > scopit.work > Manage >
   Advanced DNS > Add New Record:
     Type A Record   Host community   Value $IP

2. Send this line to Claude:
     GCP_PROJECT_ID=$PROJECT GCP_PROJECT_NUMBER=$NUMBER
EOF
