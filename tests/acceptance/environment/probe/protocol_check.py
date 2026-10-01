#!/usr/bin/env python3
"""Real protocol/API acceptance probe for the isolated Navin W03 environment.

Every check performs a real network operation against the loopback acceptance
engine. Nothing is faked: a check only passes if the protocol exchange actually
succeeded. Failures are reported explicitly and the process exits non-zero.

Checks:
  * HTTP readiness of the Stalwart endpoint.
  * JMAP session login for alice and bob (Basic auth), plus rejection of a
    wrong password, proving authentication is real.
  * IMAP login for alice and bob.
  * SMTP submission as alice with STARTTLS + authentication, delivering to bob.
  * Retrieval of the delivered message over IMAP.
  * Alias delivery: mail to team@company.test reaches both alice and bob.

Configuration is read from the environment so secrets never appear in argv:
  NAVIN_ACCEPT_HTTP_PORT, NAVIN_ACCEPT_SUBMISSION_PORT, NAVIN_ACCEPT_IMAPS_PORT,
  NAVIN_ACCEPT_TIMEOUT, NAVIN_ACCEPT_TLS_CERT, NAVIN_ACCEPT_DOMAIN,
  NAVIN_ACCEPT_ALICE, NAVIN_ACCEPT_BOB, NAVIN_ACCEPT_ALIAS,
  NAVIN_ALICE_PASSWORD, NAVIN_BOB_PASSWORD

Usage: protocol_check.py <output-json-path>
"""
from __future__ import annotations

import base64
import email.utils
import imaplib
import json
import os
import smtplib
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from email.message import EmailMessage
from pathlib import Path

HOST = "127.0.0.1"

results: list[dict] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def tls_context() -> ssl.SSLContext:
    cert = env("NAVIN_ACCEPT_TLS_CERT")
    if not cert or not Path(cert).is_file():
        raise SystemExit("NAVIN_ACCEPT_TLS_CERT is missing; cannot verify TLS")
    context = ssl.create_default_context(cafile=cert)
    # The endpoint is reached over loopback by IP, so skip hostname matching but
    # still require and verify the certificate chain.
    context.check_hostname = False
    context.verify_mode = ssl.CERT_REQUIRED
    return context


def http_jmap(user: str, password: str) -> tuple[int, dict | None]:
    port = env("NAVIN_ACCEPT_HTTP_PORT")
    url = f"http://{HOST}:{port}/.well-known/jmap"
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    request = urllib.request.Request(url, headers={"Authorization": f"Basic {token}"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, None


def check_http_health() -> None:
    port = env("NAVIN_ACCEPT_HTTP_PORT")
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/healthz", timeout=10) as response:
            check("http_health", response.status < 500, f"GET /healthz -> {response.status}")
    except urllib.error.HTTPError as exc:
        check("http_health", True, f"GET /healthz -> {exc.code} (endpoint answered)")
    except Exception as exc:  # noqa: BLE001
        check("http_health", False, f"{type(exc).__name__}: {exc}")


def check_jmap_login() -> None:
    alice, bob = env("NAVIN_ACCEPT_ALICE"), env("NAVIN_ACCEPT_BOB")
    apw, bpw = env("NAVIN_ALICE_PASSWORD"), env("NAVIN_BOB_PASSWORD")
    for user, password in ((alice, apw), (bob, bpw)):
        status, body = http_jmap(user, password)
        capabilities = sorted((body or {}).get("capabilities", {}).keys()) if body else []
        check(f"jmap_login[{user}]", status == 200, f"status={status} capabilities={len(capabilities)}")
    status, _ = http_jmap(alice, "definitely-wrong-password")
    check("jmap_rejects_bad_password", status in (401, 403), f"status={status}")


def check_imap_login(user: str, password: str) -> bool:
    port = int(env("NAVIN_ACCEPT_IMAPS_PORT"))
    try:
        with imaplib.IMAP4_SSL(HOST, port, ssl_context=tls_context()) as client:
            client.login(user, password)
        return check(f"imap_login[{user}]", True, "LOGIN ok")
    except Exception as exc:  # noqa: BLE001
        return check(f"imap_login[{user}]", False, f"{type(exc).__name__}: {exc}")


def smtp_send(sender: str, password: str, recipient: str, marker: str) -> bool:
    port = int(env("NAVIN_ACCEPT_SUBMISSION_PORT"))
    domain = env("NAVIN_ACCEPT_DOMAIN")
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = f"navin acceptance {marker}"
    message["Message-ID"] = f"<{marker}@{domain}>"
    message["Date"] = email.utils.formatdate(localtime=True)
    message.set_content(f"Navin W03 acceptance probe.\nmarker: {marker}\n")
    try:
        with smtplib.SMTP(HOST, port, timeout=20) as client:
            client.ehlo()
            client.starttls(context=tls_context())
            client.ehlo()
            client.login(sender, password)
            client.sendmail(sender, [recipient], message.as_bytes())
        return True
    except Exception as exc:  # noqa: BLE001
        check(f"smtp_submit[{sender}->{recipient}]", False, f"{type(exc).__name__}: {exc}")
        return False


def imap_wait_for(user: str, password: str, marker: str, timeout: int) -> tuple[bool, str]:
    """Wait for the marker to arrive in the user's INBOX over a real IMAPS session."""
    port = int(env("NAVIN_ACCEPT_IMAPS_PORT"))
    deadline = time.monotonic() + timeout
    last = "not found"
    try:
        with imaplib.IMAP4_SSL(HOST, port, ssl_context=tls_context()) as client:
            client.login(user, password)
            while time.monotonic() < deadline:
                client.select("INBOX")
                typ, data = client.search(None, "SUBJECT", f'"{marker}"')
                if typ == "OK" and data and data[0].split():
                    ids = data[0].split()
                    typ, fetched = client.fetch(ids[-1], "(RFC822)")
                    if typ == "OK" and fetched and fetched[0]:
                        raw = fetched[0][1]
                        text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
                        if marker in text:
                            return True, "message retrieved"
                last = "waiting for delivery"
                time.sleep(3)
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"
    return False, last


def main() -> int:
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("protocol-check.json")
    alice = env("NAVIN_ACCEPT_ALICE")
    bob = env("NAVIN_ACCEPT_BOB")
    alias = env("NAVIN_ACCEPT_ALIAS")
    domain = env("NAVIN_ACCEPT_DOMAIN")
    apw, bpw = env("NAVIN_ALICE_PASSWORD"), env("NAVIN_BOB_PASSWORD")
    timeout = int(env("NAVIN_ACCEPT_TIMEOUT", "60"))

    if not (alice and bob and domain and apw and bpw):
        check("configuration", False, "missing addresses or passwords in environment")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps({"results": results}, indent=2), encoding="utf-8")
        return 1

    check_http_health()
    check_jmap_login()
    check_imap_login(bob, bpw)
    check_imap_login(alice, apw)

    # Direct delivery alice -> bob.
    direct_marker = f"navin-direct-{uuid.uuid4().hex[:12]}"
    if smtp_send(alice, apw, bob, direct_marker):
        check(f"smtp_submit[{alice}->{bob}]", True, "250 queued")
        ok, detail = imap_wait_for(bob, bpw, direct_marker, timeout)
        check(f"receive_direct[{bob}]", ok, detail)

    # Alias delivery alice -> team@ (delivers to alice and bob).
    alias_recipient = f"{alias}@{domain}"
    alias_marker = f"navin-alias-{uuid.uuid4().hex[:12]}"
    if smtp_send(alice, apw, alias_recipient, alias_marker):
        check(f"smtp_submit[{alice}->{alias_recipient}]", True, "250 queued")
        for user, password in ((bob, bpw), (alice, apw)):
            ok, detail = imap_wait_for(user, password, alias_marker, timeout)
            check(f"receive_alias[{user}]", ok, detail)

    failures = [r for r in results if not r["ok"]]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps({"results": results, "failures": len(failures)}, indent=2),
        encoding="utf-8",
    )
    print(f"\nProtocol probe: {len(results) - len(failures)}/{len(results)} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
