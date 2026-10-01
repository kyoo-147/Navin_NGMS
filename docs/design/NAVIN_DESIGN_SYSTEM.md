# Navin Design System v1

Status: working design baseline
Scope: Navin Mail, Navin Control, Navin Desktop shell, Navin CLI.

## Core direction

Navin UI should be quiet, functional and predictable.

- Intent before layout.
- One screen, one primary job.
- Functionality expands with intent.
- Remove before adding.
- Inform, do not decorate.
- Hierarchy tells users where to look.
- Turn down everything around the subject.
- Consistency reduces friction.
- Write the rules down.
- Never let AI invent the design system repeatedly.
- Use one icon system.
- Color must mean something.
- Muted UI makes data stronger.
- Avoid generic AI colors.
- Avoid generated-layout repetition.
- Hide low-frequency actions.
- Prefer progressive disclosure.
- Design for ugly data.
- Empty, loading and error are real screens.
- Perceived speed matters.
- Users need evidence that something is happening.
- Danger deserves friction.
- Animation must earn its place.
- The UI exists to get the user to the result.

Central rule:

> AI optimizes for a screen that looks finished.
> Navin optimizes for a screen that helps someone finish something.

## Product surfaces

1. Navin Mail — Gmail-familiar daily work.
2. Navin Control — setup, administration and operations.
3. Navin CLI — conversational terminal client for Control.

Mail is dense and familiar.
Control is spacious, intent-first and evidence-first.
CLI is text-first, conversational and deterministic.

## Recommended stack

- React
- shadcn/ui
- Radix primitives
- Tailwind CSS
- Lucide icons
- Tauri for Desktop shell

## Light color tokens

```css
--bg-app: #FAFAF8;
--bg-surface: #FFFFFF;
--bg-subtle: #F6F6F3;
--bg-hover: #F2F2EE;
--bg-active: #ECEDE8;

--text-primary: #171816;
--text-secondary: #60635D;
--text-tertiary: #8A8D86;
--text-disabled: #B5B7B1;

--border-default: #E4E5E0;
--border-strong: #D3D5CF;
--divider: #ECEDE9;

--accent: #7BCB45;
--accent-hover: #6DBC39;
--accent-active: #5EA92F;
--accent-soft: #EEF8E8;
--accent-text: #32691A;
--accent-vivid: #9CEC25;

--success: #2F7D32;
--success-soft: #EDF7EE;
--warning: #A66A00;
--warning-soft: #FFF6E5;
--danger: #C83E3A;
--danger-soft: #FFF0EF;
--info: #456B8C;
--info-soft: #EFF5FA;
```

## Dark tokens

```css
--bg-app: #111210;
--bg-surface: #171816;
--bg-subtle: #1D1F1C;
--bg-hover: #252723;
--bg-active: #2D302A;

--text-primary: #F2F3EF;
--text-secondary: #AEB2A8;
--text-tertiary: #80847C;

--border-default: #2B2E29;
--border-strong: #3A3D36;

--accent: #8ED95A;
--accent-soft: #20331A;
```

Rules:
- no gradients;
- no glassmorphism;
- no random saturated blue/purple;
- brand color is not a status color;
- color indicates state, priority, action or brand.

## Typography

Recommended:
- UI: Inter or Geist
- Code/data: Geist Mono / JetBrains Mono / ui-monospace

Scale:
- 12px meta/helper
- 13px dense table/secondary
- 14px default UI
- 15px body/input comfortable
- 16px emphasized body
- 18px section title
- 20px small page title
- 24px page title
- 28px onboarding/empty title
- 32px onboarding only

Weights:
- 400 regular
- 500 medium
- 600 semibold

Avoid 700 as the default.

## Spacing

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

## Radius

```css
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 10px;
--radius-xl: 12px;
```

Guidance:
- button/input: 6–8px
- panel: 8–10px
- modal: 10–12px
- avatar: 50%

## Shadow

```css
--shadow-popover: 0 6px 24px rgba(0,0,0,.08);
--shadow-modal: 0 16px 48px rgba(0,0,0,.12);
```

Only for floating layers.

## Component sizes

Buttons:
- small 28px
- default 34–36px
- large 40px

Inputs:
- compact 32px
- default 36px
- large 42px

Icons:
- compact 14px
- normal 16px
- prominent 18px
- navigation 20px
- stroke 1.75

## Shell tokens

```css
--sidebar-width: 224px;
--sidebar-collapsed: 56px;
--header-height: 52px;
--content-max: 1440px;
--page-padding: 24px;

--mail-sidebar: 224px;
--mail-row: 40px;
--mail-toolbar: 48px;
--mail-ai-drawer: 320px;

--control-sidebar: 216px;
--control-header: 52px;
--control-content-max: 1120px;
```

## Card rule

Use cards only for independent objects such as:
- server;
- plan;
- integration;
- provider;
- deployment;
- account option.

Do not use cards merely for visual grouping.

Avoid:
- card inside card;
- generic KPI tiles;
- dashboard-by-default layouts.

## States

### Empty
Say what is missing, why it matters, and what to do next.

### Loading
Use skeleton rows or typed progress. Never show only a blank spinner.

### Error
Always show:
1. what failed;
2. why, if known;
3. what the user can do next.

### Success
Show evidence, not decoration.

## Dangerous actions

- Level 0: normal → immediate
- Level 1: reversible mutation → confirmation
- Level 2: shared infrastructure → explicit confirmation
- Level 3: destructive / MX cutover / restore / mailbox deletion → typed confirmation

## Motion

```css
--motion-fast: 120ms;
--motion-default: 180ms;
--motion-slow: 240ms;
--motion-ease: cubic-bezier(.2,.8,.2,1);
```

Animate only to explain state or transition.

## Responsive

Breakpoints:
- sm 640
- md 768
- lg 1024
- xl 1280
- 2xl 1536

Mail:
- desktop: sidebar + mail + optional AI drawer
- tablet: compact sidebar + mail, AI overlay
- mobile: list/thread split into separate screens

Control:
- desktop: sidebar + content
- tablet: collapsed sidebar
- mobile: navigation sheet + one-column forms

## Forbidden visual defaults

- gradients
- glassmorphism
- ambient glow
- giant rounded cards
- random icon systems
- AI purple/blue themes
- charts without a decision need
- decorative motion
- large illustrations in operational UI
