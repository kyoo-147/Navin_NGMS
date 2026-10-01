# Mail operations guide

This is a product and setup guide. It intentionally contains no real domain, IP address, mailbox inventory, forwarding destination, provider account, SSH path, or production evidence.

## Access

Use the webmail URL and full mailbox address supplied through the deployment's private operations channel. Aliases and distribution addresses are delivery identities unless the operator explicitly provisions them as login accounts.

## Mail clients

Obtain deployment-specific values from the administrator. A typical secure configuration is:

| Protocol | Port | Security |
|---|---:|---|
| IMAP | 993 | implicit TLS |
| SMTP submission | 587 | STARTTLS with authentication |
| SMTP submission alternative | 465 | implicit TLS with authentication |

Never select unauthenticated SMTP. Do not place mailbox passwords or generated client profiles in Git.

## Administrative access

Use Navin Control or the deployment-local administration endpoint. Administrative sessions, recovery material, server addresses, SSH commands, and account inventories belong in an approved private secrets/operations system, not repository documentation.

## Routine checks

- Verify service and listener health with `./navin-mail status` and `./navin-mail doctor`.
- Review queue, TLS, DNS, authentication, storage, and backup alerts.
- Confirm backups by restoring into an isolated environment.
- Rotate credentials through the supported Control/CLI flow.
- Treat forwarding as delivery convenience, not backup.

## Incident handling

1. Preserve logs and audit identifiers without copying message data or credentials into Git.
2. Stop destructive automation when ownership or state is uncertain.
3. Restore only after explicit approval and an isolated verification run.
4. Store production evidence privately with access control and retention policy.
