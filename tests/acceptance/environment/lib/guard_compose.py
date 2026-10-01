#!/usr/bin/env python3
"""Validate `docker compose config --format json` output for the acceptance stack.

Fails closed if the resolved compose model contains anything that could touch
production: a non-loopback port, a production port, a production resource name,
or a bind mount into production data.

Reads the compose model JSON on stdin. Exits 0 and prints OK when safe.
"""
from __future__ import annotations

import json
import sys

PRODUCTION_PORTS = {25, 465, 587, 993, 8082, 8888, 443, 80}
PRODUCTION_CONTAINERS = {"navin-mail-stalwart", "navin-mail-snappymail"}
PRODUCTION_DOMAIN = "production.example.invalid"
REQUIRED_PROJECT = "navin-acceptance"


def main() -> int:
    try:
        cfg = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"[GUARD:FAIL] compose config is not valid JSON: {exc}", file=sys.stderr)
        return 1

    violations: list[str] = []

    if cfg.get("name") != REQUIRED_PROJECT:
        violations.append(f"project name is {cfg.get('name')!r}, expected {REQUIRED_PROJECT!r}")

    for service_name, service in (cfg.get("services") or {}).items():
        container_name = service.get("container_name")
        if container_name in PRODUCTION_CONTAINERS:
            violations.append(f"service {service_name} reuses production container name {container_name!r}")

        for port in service.get("ports") or []:
            if str(port.get("protocol", "tcp")) != "tcp":
                continue
            published = str(port.get("published"))
            host_ip = port.get("host_ip")
            if host_ip != "127.0.0.1":
                violations.append(f"{service_name} publishes {published} on host_ip={host_ip!r}, must be 127.0.0.1")
            if published.isdigit() and int(published) in PRODUCTION_PORTS:
                violations.append(f"{service_name} publishes production port {published}")

        for volume in service.get("volumes") or []:
            source = str(volume.get("source", ""))
            if volume.get("type") == "bind" and (
                "credentials.env" in source or "/data" in source or source.endswith("/state")
            ):
                violations.append(f"{service_name} bind-mounts production path {source!r}")

    for network in (cfg.get("networks") or {}).values():
        name = str(network.get("name", ""))
        if not name.startswith(REQUIRED_PROJECT):
            violations.append(f"network {name!r} is not namespaced {REQUIRED_PROJECT!r}")

    for volume in (cfg.get("volumes") or {}).values():
        name = str(volume.get("name", ""))
        if not name.startswith(REQUIRED_PROJECT):
            violations.append(f"volume {name!r} is not namespaced {REQUIRED_PROJECT!r}")

    if PRODUCTION_DOMAIN in json.dumps(cfg):
        violations.append(f"resolved compose model contains production domain {PRODUCTION_DOMAIN!r}")

    if violations:
        for violation in violations:
            print(f"[GUARD:FAIL] {violation}", file=sys.stderr)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
