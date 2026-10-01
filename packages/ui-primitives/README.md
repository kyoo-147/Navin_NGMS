# @navin/ui-primitives (W17)

Minimal, accessible React primitives shared by Navin Mail, Navin Control and the setup
journey. This package intentionally contains **no business information architecture and no
visual polish** — it provides the smallest components that get keyboard, focus, ARIA,
loading, disabled and long-text behavior right so that feature workers can compose screens.

## Scope

| Area | Components |
| --- | --- |
| Actions | `Button`, `IconButton` |
| Form fields | `Input`, `Select`, `Checkbox` |
| Overlays | `Dialog`, `AlertDialog` |
| Feedback | `Toast`, `ToastProvider`, `ToastViewport`, `useToast` |
| Status | `StatusDot`, `StatusBadge` |
| Progress/loading | `Progress`, `Skeleton`, `Spinner` |
| States | `EmptyState`, `ErrorState` |
| Layout/data | `SplitPane`, `List`, `ListRow` |

## Design token consumption

Styling lives in `styles.css`, exported as `@navin/ui-primitives/styles.css`, and consumes
**semantic CSS variables only** (`--text-primary`, `--border-default`, `--accent`,
`--space-*`, `--radius-*`, `--motion-*`, …) produced by `@navin/design-system`. No hard-coded
palette values, no gradients, no decorative motion. Import the token stylesheet plus this
package's stylesheet once at the app root.

## Accessibility contract

- **Keyboard**: every interactive element is reachable by Tab and operable by keyboard.
  `Dialog` traps focus and closes on `Esc`; `SplitPane` separates on arrow keys / `Home` /
  `End`; `List` (selectable) uses roving tabindex with arrow / `Home` / `End` navigation and
  `Enter` / `Space` activation.
- **Focus**: visible `:focus-visible` outlines on every control; `Dialog` moves focus in on
  open and restores the previously focused element on close.
- **ARIA**: labelled form fields, `aria-invalid` and `aria-describedby` error wiring,
  `role="progressbar"` with `aria-valuenow`/`aria-valuetext`, `role="separator"` with value
  bounds, `role="dialog"`/`alertdialog` with `aria-modal`, `role="status"`/`alert` toasts,
  `role="listbox"`/`option` selectable lists.
- **Loading / disabled**: buttons expose `aria-busy` and block activation while loading;
  fields and rows propagate disabled state to native controls.
- **Long text**: labels, toasts, badges and list rows truncate/`overflow-wrap` instead of
  overflowing their container.

## Testing

`pnpm test` runs the jsdom + Testing Library suite in `tests/`.
