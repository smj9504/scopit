#!/bin/bash
# Startup script for the Scopit Community VM (set as its "startup-script"
# metadata by gcp-setup.sh; Google runs it as root at every boot).
#
# It only installs a timer. Every three minutes the timer asks the release
# bucket for the current release number and, when it differs from the one
# installed, downloads and runs that release's vm-agent.sh, which sets up the
# machine and installs the release. Each check is one small storage request,
# well inside the free tier.
set -eu

cat > /usr/local/sbin/community-agent <<'EOF'
#!/bin/bash
set -eu
md() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }
token=$(md instance/service-accounts/default/token | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
bucket=$(md instance/attributes/community-bucket)
get() { curl -fsS -H "Authorization: Bearer $token" "https://storage.googleapis.com/storage/v1/b/$bucket/o/release%2F$1?alt=media"; }

# Nothing released yet, or the bucket is unreachable: try again next time.
remote=$(get version 2>/dev/null) || exit 0
[ "$remote" = "$(cat /opt/answer/version 2>/dev/null || true)" ] && exit 0
# A release that failed to start is not retried; the next one is.
[ "$remote" = "$(cat /opt/answer/failed 2>/dev/null || true)" ] && exit 0
get vm-agent.sh > /run/community-agent.sh
exec bash /run/community-agent.sh "$remote"
EOF
chmod 755 /usr/local/sbin/community-agent

cat > /etc/systemd/system/community-agent.service <<'EOF'
[Unit]
Description=Scopit Community deploy agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/community-agent
EOF

cat > /etc/systemd/system/community-agent.timer <<'EOF'
[Unit]
Description=Check for a new Scopit Community release every three minutes

[Timer]
OnBootSec=30s
OnUnitActiveSec=3min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now community-agent.timer
