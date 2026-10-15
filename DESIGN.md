# TinyCloud Explorer design

## Visual theme

Option A uses a balanced workstation layout: persistent spaces rail, spatial
canvas, resource inspector, and evidence footer. The signed-in interface keeps
the shared light/dark theme. The signed-out entry and debug panel use a proposed
protocol-family mapping pending design and brand review.

The physical scene is an engineer inspecting an unfamiliar TinyCloud account
for an extended session. Density is useful, trust state is never decorative,
and every deeper view preserves the path back to the whole system.

## Color

The signed-in workspace uses the shared TinyCloud semantic tokens. On the
signed-out entry and debug panel, the proposed protocol palette is scoped to
those surfaces: `#F4F6F8` page, white card, `#0F172A` ink, `#475569`
secondary, `#D9DEE3` edge, `#2563EB` primary/focus, and `#1D4ED8` hover.
These values are not an approved Explorer family mapping. Status colors remain
paired with text or iconography.

## Typography

The signed-out entry uses self-hosted OFL-licensed Oswald for its fixed brand
and title words, Inter for UI text, and monospace for identifiers. The debug
panel uses Inter for UI and monospace for log timestamps, scopes, and details.
Signed-in typography remains the shared native system sans and monospace stacks.

## Components

- Header: identity, connection state, global search, theme, canvas export.
- Spaces rail: stable account navigation and saved tours.
- Cartograph canvas: deterministic two-column projection with peer space nodes
  feeding the selected space's resources, plus direct actions on the selected
  resource.
- Inspector: access, resource metadata, and direct next actions.
- Permission states: explicit read + write, read only, or needs permission.
  Listable resources remain named even when their contents are unavailable.
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
