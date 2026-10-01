# W03 — isolated real Stalwart acceptance environment

This directory owns the Navin W03 disposable acceptance environment. It stands up
a **real Stalwart mail engine** in an isolated container project so that later
workers (engine adapter, provisioning actions, mail gateway) can be accepted
against real protocols instead of mocks.

It is deliberately separate from the production deployment:

- Production compose/scripts/data live at the repository root (`compose.yaml`,
  `.env`, `scripts/`, `data/`, `state/`). **Nothing here reads or writes them.**
- This environment only ever runs under the `navin-acceptance` Compose project,
  network and volumes, on loopback-only non-production ports, and only uses the
  reserved RFC 6761 `.test` domain.

## Isolation guarantees

| Concern         | Production                                 | Acceptance (this directory)                                     |
| --------------- | ------------------------------------------ | --------------------------------------------------------------- |
| Compose project | `navin-mail`                               | `navin-acceptance`                                              |
| Compose file    | `compose.yaml`                             | `compose.acceptance.yaml`                                       |
| Env file        | `.env`                                     | `acceptance.env`                                                |
| Network         | `navin-mail`                               | `navin-acceptance`                                              |
| Volumes         | host bind mounts `./data/**`               | named volumes `navin-acceptance-stalwart-{etc,lib}`             |
| Containers      | `navin-mail-*`                             | `navin-acceptance-stalwart` (label `com.navin.acceptance=true`) |
| Domain          | `production.example.invalid`                        | `company.test`                                                  |
| Ports           | `25/465/587/993/8082/8888/443` on the host | `10025/10587/10143/10993/18080` on `127.0.0.1` only             |
| TLS             | Let's Encrypt                              | locally generated self-signed cert                              |

`guard.sh` fails closed if any production identifier, non-loopback port,
production port collision, or un-namespaced resource is found, and (when Docker
is present) refuses to run while a production container is up.

## Fixtures

- `alice@company.test` — password generated at seed time; account alias `alice.alias@company.test`.
- `bob@company.test` — password generated at seed time.
- `team@company.test` — distribution alias delivering to **both** alice and bob.

Generated credentials are written only under `generated/` with mode `0600` and
are never printed or committed (`generated/` is git-ignored).

## Pinned images

Pinned by version **and** digest (resolved 2026-10-01):

- `stalwartlabs/stalwart:v0.16.24@sha256:ec011be228596e37e65f41aab17deed573859614430472f7eeb42178c50d87b7`
- `ghcr.io/stalwartlabs/cli:1.0.13@sha256:9a1e07307d6f890a193322c4b737fc0868405f0f8486a19922cbf362f43884fd`

## Layout

```
compose.acceptance.yaml          isolated compose definition (repo root)
tests/acceptance/environment/
  acceptance.env                 non-secret config + image pins
  guard.sh                       production guard (static + docker-aware)
  up.sh                          guard -> pull -> up -> readiness
  readiness.sh                   HTTP readiness polling
  seed.sh                        bootstrap, TLS, domain, alice/bob, alias, listener
  verify.sh                      real protocol/API verification
  down.sh                        teardown (containers, network, volumes)
  run.sh                         full orchestration + evidence, always tears down
  lib/common.sh                  shared helpers and paths
  lib/stalwart_json.py           normalize Stalwart CLI JSON output
  lib/guard_compose.py           validate `docker compose config` output
  lib/evidence.sh                redacted evidence capture
  probe/protocol_check.py        real HTTP/JMAP + SMTP + IMAP checks
  test/capture-contract.test.sh  credential-capture contract test (no Docker)
  generated/                     runtime credentials, state and evidence (ignored)
```

## Prerequisites

- 64-bit Linux host with Docker Engine and Docker Compose v2.
- `bash` 4+, `python3`, `curl`, `openssl`.
- Ports `10025, 10587, 10143, 10993, 18080` free on `127.0.0.1`.

## Usage

Full run (recommended) — starts, seeds, verifies, captures evidence, tears down:

```bash
tests/acceptance/environment/run.sh
```

Individual phases:

```bash
tests/acceptance/environment/guard.sh      # production guard only
tests/acceptance/environment/up.sh         # start + readiness
tests/acceptance/environment/seed.sh       # provision fixtures
tests/acceptance/environment/verify.sh     # protocol verification
tests/acceptance/environment/down.sh       # teardown
tests/acceptance/environment/down.sh --purge   # teardown + delete generated/
```

`run.sh --keep` leaves the stack running for inspection (tear it down later with
`down.sh`).

Docker-free contract test (credential-capture safety):

```bash
tests/acceptance/environment/test/capture-contract.test.sh
```

## Evidence

Each `run.sh` execution writes a redacted bundle to
`tests/acceptance/environment/generated/evidence/<UTC timestamp>/`:

- `versions.txt`, `images.txt` (resolved pinned digests)
- `guard.txt`, `up.txt`, `seed.txt`, `verify.txt`, `teardown.txt`
- `compose-config.yaml`, `compose-ps.txt`, `containers.txt`, `stalwart.log`
- `summary.md`, `summary.json` (per-check pass/fail)

## What this proves (and does not)

Proves: a real Stalwart engine can be started in isolation, provisioned with a
domain/users/alias through its real admin API, and exercised over real
SMTP/JMAP/IMAP with authentication and alias delivery — with no production
contact.

Does not prove: external DNS/PTR/port-25 deliverability, TLS from a public CA,
or anything about the production VPS. Those remain separate, explicitly
authorized external gates.
