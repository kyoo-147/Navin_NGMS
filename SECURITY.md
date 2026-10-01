# Security Policy

## Scope

Security reports are welcome for NGMS source code, deployment scripts, daemon behavior, contracts, authentication, authorization, secrets handling, mail protocol handling, backup and restore, and documented operational procedures.

The following are generally outside the scope of a vulnerability in NGMS itself unless they demonstrate an NGMS security boundary failure:

- compromise of the host, operating system, cloud account, DNS account, or mail provider before NGMS is involved;
- third-party mail-provider filtering, throttling, reputation, or inbox-placement decisions;
- insecure local configuration that contradicts the documented deployment requirements;
- denial of service against an unprotected public installation without a reproducible NGMS-specific flaw.

## Supported versions

Security fixes are prioritized for the latest `main` branch and the latest published release, when releases are available. Older revisions may not receive fixes. Deployments should pin reviewed versions and apply security updates through a tested change process.

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability.

Use GitHub's private vulnerability reporting flow from the repository's **Security** tab when it is enabled. If that option is unavailable, contact the repository maintainers privately through a verified maintainer channel and include **NGMS security report** in the subject.

A useful report includes:

- affected commit, release, package, script, or deployment mode;
- concise description of the security impact;
- reproducible steps or a minimal proof of concept;
- required privileges, configuration, and environmental assumptions;
- logs, traces, or screenshots with credentials and private mail content removed;
- suggested mitigation, if known.

Do not include live credentials, private keys, mailbox contents, personal data, public IPs that do not need to be disclosed, or production access details.

## Response process

Maintainers will acknowledge a report when practical, reproduce and triage it, determine affected versions, and coordinate a fix or mitigation. Timelines depend on severity, reproducibility, maintainer availability, and whether a report affects a live deployment or only planned functionality.

Please allow reasonable time for a fix before public disclosure. Coordinated disclosure is preferred. Do not test against infrastructure you do not own or have explicit permission to assess.

## Security design boundaries

NGMS is designed around:

- separate Mail and Control authority;
- scoped sessions and typed permissions;
- plan, diff, approval, apply, verify, and rollback for high-risk actions;
- redacted logs and audit/evidence records that exclude message content and secrets;
- server-authoritative authorization;
- explicit backup and restore verification;
- trusted extensions that are treated as powerful code, not falsely advertised as sandboxed;
- disposable acceptance environments that must not contact live production.

Security documentation does not constitute a guarantee that every deployment is secure. Operators remain responsible for host hardening, DNS account security, credential management, network exposure, backups, updates, and the operational configuration of their installation.
