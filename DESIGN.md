# TinyCloud Explorer design

## Visual theme

Option A uses a balanced workstation layout: persistent spaces rail, spatial
canvas, resource inspector, and evidence footer. The interface is light by
default with a complete dark theme inherited from `@tinycloud/styles`.

The physical scene is an engineer inspecting an unfamiliar TinyCloud account
for an extended session. Density is useful, trust state is never decorative,
and every deeper view preserves the path back to the whole system.

## Color

Use the shared TinyCloud semantic tokens without redefining the brand palette.
Blue is limited to primary action, current selection, focus, and verified
evidence. Neutral surfaces, hairlines, and dotted boundaries carry structure.
Status colors are always paired with text or iconography.

## Typography

Use the shared native system sans stack for interface text and native
monospace stack for identifiers, paths, values, and SQL. The scale is fixed and
compact. Labels use weight and proximity before uppercase or tracking.

## Components

- Header: identity, connection state, global search, theme, canvas export.
- Spaces rail: stable account navigation and saved tours.
- Cartograph canvas: deterministic two-column projection with peer space nodes
  feeding the selected space's resources, plus direct actions on the selected
  resource.
- Inspector: access, resource metadata, and direct next actions.
- Evidence footer: session → delegation → space → resource verification.
- SQL reader: table list, table data, and query runner.
- KV reader: key list plus structured value and metadata tabs.

## Layout

Desktop uses four persistent bands: header, three-column workspace, evidence
footer, and status line. The workspace columns are 15rem, minmax(30rem, 1fr),
and 21rem. At tablet widths the inspector becomes a contextual panel. Below
48rem the canvas becomes a list-based ledger with the same information
architecture and no hidden core functionality.

## Motion

Use 150–220ms state transitions for selection, disclosure, and semantic zoom.
No page-load choreography. Reduced-motion users receive immediate state
changes.

## Accessibility

Target WCAG 2.2 AA. Canvas nodes remain focusable DOM controls in a stable
reading order. `1`, `2`, and `3` switch semantic zoom; Escape moves up one
level. Dynamic context changes are announced, focus is visible, and touch
targets are at least 44 CSS pixels.
