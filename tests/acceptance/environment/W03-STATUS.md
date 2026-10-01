# W03 status and validation record

Date: 2026-10-01
Scope: isolated real-Stalwart acceptance environment (`compose.acceptance.yaml` +
`tests/acceptance/environment/**`).

## Delivered

- `compose.acceptance.yaml` — isolated Compose project `navin-acceptance` with
  unique network/volumes, loopback-only non-production ports, and the Stalwart
  engine pinned by version **and** digest.
- `tests/acceptance/environment/` — production guard, startup, readiness, seed,
  real-protocol verification, teardown, orchestrated run and redacted evidence
  capture. Fixtures: `alice@company.test`, `bob@company.test`,
  `team@company.test` (alias → both), generated credentials kept mode `0600`
  under the git-ignored `generated/` tree.

## Credential-capture safety (V3 review fix)

`create_account` previously emitted a human `[ OK ] ...` line on stdout before
the tab-separated credential line, so `alice_password="$(create_account ... |
cut -f2)"` captured status text plus the password and could write a corrupt
`mailbox-credentials.env`. Fixed fail-closed:

- `create_account` now writes exactly one machine-readable line
  (`<address><TAB><password>`) to stdout; its human messages go to stderr.
- `capture_password` parses that line via `parse_credential_line`, and
  `require_one_token` rejects any capture that is empty, multiline (CR/LF) or
  contains whitespace, so an invalid password can never reach the credentials
  file.
- `test/capture-contract.test.sh` unit-tests the pure helpers **and** drives the
  real `create_account` through stubs, asserting one stdout line, a valid
  password, and stderr-only status text.

## Static validation performed here (no container runtime required)

| Check                       | Command                               | Result                                                                                                     |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Shell syntax (10 scripts)   | `bash -n`                             | all pass                                                                                                   |
| Python syntax (3 modules)   | `python -m py_compile`                | all pass                                                                                                   |
| Compose YAML parse          | PyYAML `safe_load`                    | pass (project/ports/volumes/network resolved)                                                              |
| Production guard (static)   | `guard.sh`                            | pass — no production identifiers, all 5 ports loopback-bound, no production-port collision, `.test` domain |
| Guard-compose logic         | `guard_compose.py` on good/bad models | good → OK; bad → 6 violations, exit 1                                                                      |
| Stalwart JSON normalization | `stalwart_json.py`                    | `id-by-name`, `first-id`, `has-name` correct                                                               |
| Credential-capture contract | `test/capture-contract.test.sh`       | 14 checks pass (multiline/whitespace captures fail closed)                                                 |
| Probe fail-closed           | `protocol_check.py` with no config    | exits 1, writes failure JSON (no fake pass)                                                                |
| Evidence summary            | `evidence_summary` on sample state    | renders `summary.md` + `summary.json` with per-check pass/fail                                             |

These prove the environment _definition_, guard and tooling are correct. They are
**not** a substitute for the real protocol run below.

## Runtime acceptance blocker (exact)

The full run (`run.sh`: guard → up → readiness → seed → verify → teardown)
**could not be executed on this machine**. This host is Microsoft Windows 11 Home
Single Language with no container runtime:

```
docker        MISSING
docker-compose MISSING
podman        MISSING
nerdctl       MISSING
Docker Desktop MISSING (C:\Program Files\Docker\Docker\...)
wsl.exe       present but non-functional:
              "The service cannot be started, either because it is disabled or
               because it has no enabled devices associated with it."
```

There is therefore no way to start the pinned Stalwart container, provision the
fixtures, or run the SMTP/JMAP/IMAP probe here. `docker compose config` also
cannot run, so the compose model was validated by YAML parse + the static guard
instead.

To execute the real acceptance run, run on a 64-bit Linux host with Docker
Engine + Compose v2, `python3`, `curl`, `openssl`, and ports
`10025/10587/10143/10993/18080` free on loopback:

```bash
tests/acceptance/environment/run.sh
```

Evidence lands in `tests/acceptance/environment/generated/evidence/<UTC>/`.

## Pinned images (resolved 2026-10-01)

| Image                             | Digest                                                                    | Source             |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------ |
| `stalwartlabs/stalwart:v0.16.24`  | `sha256:ec011be228596e37e65f41aab17deed573859614430472f7eeb42178c50d87b7` | Docker Hub tag API |
| `ghcr.io/stalwartlabs/cli:1.0.13` | `sha256:9a1e07307d6f890a193322c4b737fc0868405f0f8486a19922cbf362f43884fd` | GHCR manifest      |
