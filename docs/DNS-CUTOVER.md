# DNS cutover guide

This document is a deployment template. Keep real domains, IP addresses, DKIM values, provider names, account addresses, and validation evidence outside Git.

## Inputs

Set these values in the local, ignored `.env` file:

- `DOMAIN`: the mail domain.
- `MAIL_HOSTNAME`: the public mail host.
- `WEBMAIL_HOSTNAME`: the public webmail host.
- `SERVER_IPV4`: the authorized server address.
- `DKIM_SELECTORS`: selectors produced by the deployed engine.

Examples in this repository use IANA-reserved names and addresses only, such as `example.com` and `203.0.113.10`.

## Before cutover

1. Preserve unrelated website and service records.
2. Confirm forward DNS and provider-managed PTR agree.
3. Issue valid TLS certificates for every published hostname.
4. Publish SPF, DKIM, and DMARC in monitoring mode.
5. Verify externally reachable SMTP, submission, IMAPS, and HTTPS endpoints.
6. Complete an isolated backup restore drill.
7. Record real evidence in an approved private evidence store, never in Git.

## Record shapes

Use values generated for the authorized deployment:

| Type | Host | Example shape |
|---|---|---|
| A/AAAA | mail host | authorized server address |
| MX | apex | priority plus mail hostname |
| TXT | apex | SPF policy |
| TXT | DKIM selector | engine-generated public key |
| TXT | `_dmarc` | DMARC policy and deployment-owned reporting address |

Do not copy DKIM values between deployments. Do not publish IPv6 until both forward and reverse DNS are correct.

## Verification

Run from the deployed checkout after populating the ignored local configuration:

```bash
sudo ./navin-mail dns
sudo ./navin-mail doctor
```

Then validate inbound and outbound delivery with independent test accounts. Check received-message headers for SPF, DKIM, and DMARC results. Passing authentication does not guarantee inbox placement.
