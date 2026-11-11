#!/bin/bash
# Scopit Community deploy agent: sets up the VM and installs one release.
#
#   bash vm-agent.sh <release>
#
# The VM's timer (vm-startup.sh) downloads this file from the release bucket
# and runs it as root when the bucket holds a release that is not installed.
# Safe to re-run. Progress goes to the serial console, which the deploy
# workflow prints when a release does not come up.
set -euo pipefail

RELEASE=${1:?usage: vm-agent.sh <release>}
APP=/opt/answer
DATA=/var/lib/answer
STATE=/var/lib/community-agent
SETUP_VERSION=1 # bump when the machine setup below changes

log() { echo "community-agent: $*" | tee -a /dev/ttyS0 2>/dev/null || true; }
trap 'log "failed at line $LINENO"' ERR

md() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }
TOKEN=$(md instance/service-accounts/default/token | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
PROJECT=$(md project/project-id)
BUCKET=$(md instance/attributes/community-bucket)
DOMAIN=$(md instance/attributes/community-domain)

fetch() { # fetch <release file> <destination>
  curl -fsS -H "Authorization: Bearer $TOKEN" -o "$2" \
    "https://storage.googleapis.com/storage/v1/b/$BUCKET/o/release%2F$1?alt=media"
}
secret() { # secret <name>: latest version from Secret Manager
  curl -fsS -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/$1/versions/latest:access" |
    sed -n 's/.*"data": *"\([^"]*\)".*/\1/p' | base64 -d
}

mkdir -p "$STATE" "$APP"

# ---------- Machine setup (once per SETUP_VERSION) ----------

if [ "$(cat "$STATE/setup" 2>/dev/null || true)" != "$SETUP_VERSION" ]; then
  log "setting up the machine (setup $SETUP_VERSION)"

  # The e2-micro has 1 GB of memory; 1 GB of swap keeps upgrades from failing.
  if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon --show | grep -q /swapfile || swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab

  # Caddy (HTTPS with automatic Let's Encrypt certificates) and security
  # updates, both from Debian itself.
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q caddy sqlite3 unattended-upgrades
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
    >/etc/apt/apt.conf.d/20auto-upgrades

  id answer >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin answer
  mkdir -p "$DATA"
  chown answer:answer "$DATA"

  cat >/etc/systemd/system/answer.service <<EOF
[Unit]
Description=Scopit Community (Apache Answer)
After=network-online.target
Wants=network-online.target
ConditionPathExists=$APP/answer

[Service]
User=answer
Group=answer
WorkingDirectory=$DATA
ExecStart=$APP/answer run -C $DATA
Restart=always
RestartSec=5
# Keep Go's heap well inside the machine's memory.
Environment=GOMEMLIMIT=400MiB

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable answer.service
  echo "$SETUP_VERSION" >"$STATE/setup"
fi

# Caddy serves the domain from instance metadata over HTTPS.
caddyfile="$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:9080
}
"
if [ "$(cat /etc/caddy/Caddyfile 2>/dev/null || true)" != "$caddyfile" ]; then
  printf '%s' "$caddyfile" >/etc/caddy/Caddyfile
  systemctl reload-or-restart caddy
fi

# ---------- Release ----------

log "installing release $RELEASE"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for f in answer fonts.tar.gz SHA256SUMS; do fetch "$f" "$tmp/$f"; done
cp "$0" "$tmp/vm-agent.sh"
(cd "$tmp" && sha256sum -c --quiet SHA256SUMS)
install -m 755 "$tmp/answer" "$APP/answer.new"

if [ ! -f "$DATA/conf/config.yaml" ]; then
  log "first install"
  (
    export AUTO_INSTALL=true INSTALL_PORT=9081 DB_TYPE=sqlite3 DB_FILE="$DATA/answer.db" \
      LANGUAGE=ko_KR SITE_NAME='Scopit Community' SITE_URL="https://$DOMAIN" \
      CONTACT_EMAIL=claims@scopit.work ADMIN_NAME=scopitadmin EXTERNAL_CONTENT_DISPLAY=ask_before_display
    ADMIN_EMAIL=$(secret community-admin-email)
    ADMIN_PASSWORD=$(secret community-admin-password)
    export ADMIN_EMAIL ADMIN_PASSWORD
    cd "$DATA"
    # Answer installs from the environment, then exits about a second later.
    timeout 120 runuser -u answer -- "$APP/answer.new" init -C "$DATA" >/dev/null
  )
  if [ ! -f "$DATA/conf/config.yaml" ] || [ ! -f "$DATA/answer.db" ]; then
    log "first install did not finish"
    exit 1
  fi
  sed -i 's/^\(    addr: \).*/\1127.0.0.1:9080/' "$DATA/conf/config.yaml"
fi

mkdir -p "$DATA/uploads/branding/fonts"
tar -xzf "$tmp/fonts.tar.gz" -C "$DATA/uploads/branding/fonts"
chown -R answer:answer "$DATA"

systemctl stop answer 2>/dev/null || true
if [ -f "$APP/answer" ]; then cp -p "$APP/answer" "$APP/answer.prev"; fi
mv "$APP/answer.new" "$APP/answer"
runuser -u answer -- "$APP/answer" upgrade -C "$DATA" >/dev/null
systemctl start answer

up() { curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:9080/; }
for _ in $(seq 1 30); do up && break || sleep 2; done
if ! up; then
  log "release $RELEASE did not start"
  echo "$RELEASE" >"$APP/failed"
  if [ -f "$APP/answer.prev" ]; then
    mv "$APP/answer.prev" "$APP/answer"
    systemctl restart answer
    log "went back to the previous release"
  fi
  exit 1
fi

echo "$RELEASE" >"$APP/version"
rm -f "$APP/failed"
# Read by the deploy workflow at https://<domain>/uploads/branding/release.txt
printf '%s' "$RELEASE" >"$DATA/uploads/branding/release.txt"
chown answer:answer "$DATA/uploads/branding/release.txt"
# Ask Caddy to retry the certificate now, in case DNS was added since.
systemctl reload caddy || true
log "release $RELEASE is running"
