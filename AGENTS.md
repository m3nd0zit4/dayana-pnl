<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Building a CRM screen?

Read `docs/crm-ui-contract.md` first. Ten rules covering where the primary
action goes, how lists, empty states and public-page links are built, and modal
footer order. They are enforced by `e2e/crm-contract.spec.ts`, so ignoring them
fails CI rather than merging quietly.

The primitives are in `app/components/admin/crm/ui/`. Use them. The panel
already went through a phase where each section re-derived the same markup, and
it ended up with five different "see the public page" buttons.

`DESIGN.md` covers the visual language — type, colour, spacing — and applies to
every surface.
