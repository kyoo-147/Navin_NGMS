#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
[[ "$(id -u)" -eq 0 ]] || fail "Run backup timer installation as root"
require_command systemctl

cat >/etc/systemd/system/navin-mail-backup.service <<EOF
[Unit]
Description=Consistent local backup of Navin Mail
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=$ROOT_DIR/navin-mail backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF

cat >/etc/systemd/system/navin-mail-backup.timer <<'EOF'
[Unit]
Description=Daily Navin Mail backup timer

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=20m
Persistent=true
Unit=navin-mail-backup.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now navin-mail-backup.timer
pass "Enabled daily local backup timer (03:30 with up to 20 minutes jitter)"
warn "Configure an offsite copy target; same-VPS backups do not cover VPS loss"
