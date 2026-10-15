# TinyCloud Explorer design

## Visual theme

Option A uses a balanced workstation layout: persistent spaces rail, spatial
canvas, resource inspector, and evidence footer. The signed-out entry/debug
panel and signed-in light workspace use a proposed protocol-family mapping
pending design and brand review. Signed-in dark keeps the shared theme.

The physical scene is an engineer inspecting an unfamiliar TinyCloud account
for an extended session. Density is useful, trust state is never decorative,
and every deeper view preserves the path back to the whole system.

## Color

The proposed light palette is scoped to Explorer's entry/debug panel and
signed-in workspace: `#F4F6F8` page, white surfaces, `#0F172A` ink, `#475569`
secondary, `#D9DEE3` hairline, `#2563EB` primary/focus, and `#1D4ED8` hover.
Primary controls use white text. Entry errors use a white attention banner with
a hairline and warning icon; the message remains unchanged. These values are
not an approved Explorer family mapping. Dark continues to use shared tokens.

## Typography

Self-hosted OFL-licensed Oswald is reserved for fixed brand/title words: the
signed-out heading and TinyCloud Explorer wordmark. Inter is used for UI text
on the entry/debug panel and signed-in light workspace; identifiers, log
timestamps, scopes, SQL and KV values remain monospace. Signed-in dark retains
the shared native system sans and monospace stacks.

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

On the light desktop canvas, initial and Fit View framing reserve a right
gutter for the 44px zoom/fit stack so it does not cover node content. Manual
pan and zoom remain user-controlled.

## Motion

Use 150–220ms state transitions for selection, disclosure, and semantic zoom.
No page-load choreography. Reduced-motion users receive immediate state
changes.

## Accessibility

Target WCAG 2.2 AA. Desktop canvas nodes have a keyboard focus outline
distinct from selection. Passive edges are skipped by Tab; Enter or Space
selects a node, updates the inspector, and announces its selected state.
Shift+Enter opens its space or resource. `1`, `2`, and `3` switch semantic zoom;
Escape moves up one level or clears the selected resource at system level.
Node deletion is not a keyboard action. On phone the ledger is the map
alternative; opening the
signed-out debug panel gives it its own grid row, leaving entry controls in a
scrollable region so their keyboard focus cannot hide behind the panel. Touch
targets are at least 44 CSS pixels.
