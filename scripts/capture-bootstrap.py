#!/usr/bin/env python3
"""Capture one-time Stalwart bootstrap credentials without printing the secret."""
from __future__ import annotations

import re
import shlex
import subprocess
from pathlib import Path

logs = subprocess.check_output(
    ["docker", "logs", "navin-mail-stalwart"],
    stderr=subprocess.STDOUT,
    text=True,
)
username: str | None = None
password: str | None = None

username_match = re.search(r"username\s*:\s*([^\s]+)", logs, re.IGNORECASE)
password_match = re.search(r"password\s*:\s*([^\s]+)", logs, re.IGNORECASE)
if username_match and password_match:
    username = username_match.group(1).strip("'\"")
    password = password_match.group(1).strip("'\"")

if not (username and password):
    combined = re.search(
        r"administrator account is ['\"]([^'\"]+)['\"] with password ['\"]([^'\"]+)['\"]",
        logs,
        re.IGNORECASE,
    )
    if combined:
        username, password = combined.group(1), combined.group(2)

if not (username and password):
    raise SystemExit("Bootstrap credentials were not found in Stalwart logs")

credentials_path = Path(__file__).resolve().parent.parent / "credentials.env"
credentials_path.write_text(
    "STALWART_URL=http://stalwart:8080\n"
    f"STALWART_USER={shlex.quote(username)}\n"
    f"STALWART_PASSWORD={shlex.quote(password)}\n",
    encoding="utf-8",
)
credentials_path.chmod(0o600)
print("BOOTSTRAP_CREDENTIALS_STORED=yes")
print(f"BOOTSTRAP_USER={username}")
print(f"PASSWORD_LENGTH={len(password)}")
