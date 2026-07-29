# Product

## Register

product

## Users

TinyCloud developers and operators inspecting data they own or can access.
They are usually debugging an application, verifying a delegation, or trying
to understand what exists in a TinyCloud account without dropping into a CLI.

## Product Purpose

TinyCloud Explorer turns an authenticated TinyCloud account into a legible,
interactive map. It discovers spaces and their resources, preserves the
authorization trail behind every visible object, and provides focused tools
for reading key-value data and exploring SQL tables and queries.

Success means a user can sign in through the real TinyCloud flow, understand
the shape of their cloud at a glance, move from account to space to resource,
and inspect useful data without losing security context.

## Brand Personality

Sovereign, rigorous, and open. The interface should feel calm under dense
technical information, explicit about trust boundaries, and confident without
performing technical complexity.

## Anti-references

- Generic crypto dashboards built around token metrics or glowing network maps
- Force-directed node editors with tangled edges and no stable reading order
- Whiteboards that require manual arrangement before they become useful
- Database tools that hide identity, capability, or delegation context
- Decorative glass, oversized cards, and marketing-page hierarchy inside the
  authenticated product

## Design Principles

1. Map first, evidence always. Spatial context and authorization context remain
   available throughout exploration.
2. Progressive disclosure follows the system: account, space, resource, value.
3. The map is generated before it is editable. Manual layout is an enhancement,
   never a prerequisite.
4. Familiar inspection tools beat novel controls. SQL behaves like a database
   browser; key-value data behaves like a structured object viewer.
5. Read-only by default. The initial release favors trustworthy exploration
   over a broad mutation surface; permission grants remain explicit,
   capability-scoped actions.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Every canvas object has a stable linear keyboard and screen
reader representation. Color never carries status alone, focus is always
visible, motion respects reduced-motion preferences, touch targets are at least
44 by 44 CSS pixels, and narrow screens receive a list-based ledger view rather
than a compressed desktop canvas.
