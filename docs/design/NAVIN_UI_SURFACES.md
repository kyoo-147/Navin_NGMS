# Navin UI Surfaces

## 1. Navin Mail

Daily work environment. Gmail-like mental model with optional AI drawer.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ☰   Navin Mail              [ Search mail........................ ]      ⚙ ● │
├────────────────┬──────────────────────────────────────┬──────────────────────┤
│ + Compose      │ Primary   Updates   Social           │ Ask Navin · Mail     │
│                ├──────────────────────────────────────┤                      │
│ Inbox       42 │ □ ☆ Michael   Project update  10:32 │ Summarize inbox      │
│ Starred        │ □ ☆ Jerri     Finance build   09:11 │ Find action items    │
│ Snoozed        │ □ ☆ Provider  VPS notice      Sep29 │ Draft replies        │
│ Sent           │ □ ☆ PA VN     DNS login       Sep29 │ Follow-ups           │
│ Drafts      3  │                                      │                      │
│ Labels         │                                      │ [ Ask about mail… ]  │
└────────────────┴──────────────────────────────────────┴──────────────────────┘
```

Rules:
- AI drawer is optional.
- Inbox must work fully without AI.
- Mail rows are rows, not cards.
- Infrastructure settings never appear in Mail navigation.

## 2. Navin Control

Input-first operator surface.

```text
┌────────────────┬─────────────────────────────────────────────────────────────┐
│ Navin          │ Navin Research                                  ● Healthy │
│ + New task     │                                                             │
│ Instances      │                What do you want to do?                      │
│  Production    │                                                             │
│ Organization   │       ┌─────────────────────────────────────────┐           │
│  People        │       │ Describe what you need...               │           │
│  Domains       │       │ @Production     Auto ▾              ↑   │           │
│  Groups        │       └─────────────────────────────────────────┘           │
│ Operations     │                                                             │
│  Delivery      │       Suggested                                             │
│  Security      │       Add a mailbox                                         │
│  Backup        │       Set up another domain                                │
│  Migration     │       Check deliverability                                  │
│ AI             │       Move mail from Gmail                                 │
│  Providers     │       Restore backup                                        │
│  Agents        │                                                             │
│ Activity       │                                                             │
│ Settings       │                                                             │
└────────────────┴─────────────────────────────────────────────────────────────┘
```

Core flow:

```text
Intent
→ Plan
→ Review
→ Approve
→ Execute
→ Verify
→ Result
```

## 3. Navin Desktop

One application with two permission-aware modules.

First launch:

```text
Launch
→ Sign in
→ Surface chooser
→ Mail / Control
```

Surface chooser:

```text
┌───────────────────────────────────────────────────────────────┐
│ Navin                                            Michael ●    │
│                                                               │
│                 What do you want to open?                      │
│                                                               │
│      ┌────────────────────┐   ┌────────────────────┐          │
│      │ Mail               │   │ Control            │          │
│      │ Email, calendar,   │   │ Setup, configure, │          │
│      │ contacts and AI    │   │ operate and manage│          │
│      │ Open Mail          │   │ Open Control       │          │
│      └────────────────────┘   └────────────────────┘          │
│                                                               │
│      □ Remember my choice on this device                      │
└───────────────────────────────────────────────────────────────┘
```

Rules:
- normal user: Mail only
- admin: Mail + Control
- Control-only operator: Control only
- remembered choice can skip chooser
- backend still authorizes every request

## 4. Navin CLI

Conversational Control client.

```text
Navin CLI

Instance   Production
Account    alice@production.example.invalid
Status     Connected

────────────────────────────────────────────

What do you want to do?

> _
```

Example:

```text
> create bob@production.example.invalid and make
  bob.alias@production.example.invalid an alias
```

```text
Plan

+ Mailbox
  bob@production.example.invalid

+ Alias
  bob.alias@production.example.invalid
  → bob@production.example.invalid

No destructive changes.

Apply? [Y/n]
```

Status symbols:
- ○ pending
- ◐ running
- ✓ completed
- ! warning
- × failed
