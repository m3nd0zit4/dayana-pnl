# DESIGN.md

Documents the design system as it actually exists in this codebase today. Written
retroactively (via `/design-consultation`, "document existing" path) rather than
proposed from scratch — this brand already shipped and works; the goal here is to
turn it into a reference instead of tribal knowledge, so future sessions calibrate
against it instead of re-deriving from vibes.

## Product context

Dayana Beltrán PNL — a solo coaching/therapy practice (NLP/PNL) with three surfaces
sharing one codebase:
1. **Marketing site** (`/`) — public, warm/editorial, sells therapy/course/workshops.
2. **CRM** (`/admin`) — internal staff tool, calm and dense.
3. **Member portal** (`/miembros`) — paying course members' course player + dashboard.

Memorable thing: warm, human, editorial — a solo practitioner's brand, not a SaaS
product. Nothing here should read as generic startup chrome.

## Typography

Two type systems, deliberately different per surface — this is intentional, not drift:

**Marketing site:** self-hosted **Lausanne** (300 = body, 500 = heading/emphasis),
applied via literal Tailwind arbitrary classes `font-[font1]` (body) / `font-[font2]`
(heading) — not the Tailwind `font-sans`/`font-heading` theme keys, applied directly
at the call site across payment/checkout/marketing components. A secondary
"reference replica" pairing of **Space Grotesk** (500/700) + **DM Mono** (400/500) is
also loaded for specific marketing sections that want a more geometric/technical feel.

**CRM + member portal (shadcn-driven components):** fall back to
`--font-heading: font2, "Space Grotesk", sans-serif` and
`--font-sans: font1, -apple-system, ...` — same Lausanne family, just referenced
through the `@theme inline` mapping instead of arbitrary classes, since these
surfaces compose from shadcn primitives (`CardTitle`, etc.) that read the theme
keys rather than being hand-styled per component.

**Never** introduce `Inter`, `Roboto`, `Arial`, or a bare `system-ui`/`-apple-system`
stack as a *primary* typeface — `-apple-system` only appears today as the tail of a
fallback chain behind the real brand font, never as the lead.

## Color

All colors are CSS custom properties in `app/globals.css`, mapped into Tailwind via
`@theme inline` — no default Tailwind/shadcn palette values are used unmodified.
Single palette (no dark mode; `.dark` variant is wired but never applied).

| Token | Value | Use |
|---|---|---|
| `--background` | `#f6f2eb` | Page background — warm cream, not white |
| `--foreground` | `#141210` | Body text — near-black, not pure black |
| `--card` | `#fffcf8` | Card/surface background |
| `--primary` | `#5c4a3a` | Buttons, active states, brand accent — muted brown-gold |
| `--primary-foreground` | `#ece3d4` | Text on primary |
| `--secondary` | `#ece3d4` | Secondary surface (warm beige) |
| `--muted-foreground` | `#6f655c` | De-emphasized text |
| `--accent` | `#edc3b1` | Blush accent |
| `--destructive` | `#b33a3a` | Errors/destructive actions |
| `--border` | `rgba(20,18,16,0.08)` | Hairline borders — subtle, not gray-500 |
| `--sidebar*` | mirrors `--card`/`--primary`/`--border` | App-shell sidebar (CRM + course player) |
| `--chart-1..5` | brown/blush/green/gold/sand | Reserved for future data-viz, unused today |

Marketing-site-only extra tokens (`--color-ink`, `--color-paper`, `--color-linen`,
`--color-blush`, `--color-sand`, `--color-terracotta`) exist alongside the shadcn set
for hand-built marketing sections and email templates (`lib/notifications/templates/email-layout.ts`
reuses this exact palette as `BRAND_EMAIL`, so the email system already stays in sync
with the site — keep it that way).

**Never** use a purple/violet/indigo gradient, a default `blue-500`/`gray-500`
Tailwind color, or any hex not traceable to this table.

## Spacing & radius

- `--radius: 0.625rem` (10px) is the base; `--radius-sm/md/lg/xl/2xl/3xl/4xl` scale
  from it via `calc()` — never hardcode a `rounded-*` pixel value that isn't one of
  these derived steps.
- Card internal spacing uses a `--card-spacing` CSS var (`--spacing(4)` default,
  `--spacing(3)` for `size="sm"`) rather than hardcoded padding utilities — new
  components using `Card` inherit this automatically.

## Component vocabulary

Base UI (`@base-ui/react`), not Radix — confirmed via `components.json`. Before
adding any new UI primitive, check `app/components/ui/` first:

`Button`, `Card`/`CardHeader`/`CardContent`/`CardFooter`, `Badge`, `Progress`,
`Accordion`, `Tabs`, `Sidebar` (+`SidebarProvider`/`SidebarInset`/`SidebarHeader`/
`SidebarContent`/`SidebarTrigger`), `Textarea`/`Input`/`Label`, `Dialog`/`Drawer`
(unified via `CrmModal` — dialog on desktop, bottom-sheet drawer on mobile),
`Tooltip`, `Checkbox`, `Separator`, `Toaster` (sonner-based).

**Sidebar pattern:** exactly one `SidebarProvider`/`Sidebar`/`SidebarInset` shell per
page — the CRM (`CrmShell.tsx`) and the course player (`CoursePlayer.tsx`) both use
it directly. Never stack a second app-chrome sidebar next to a content sidebar; if a
page has its own content-outline sidebar (like the course player), that IS the page's
one sidebar — don't also wrap it in the generic portal nav.

**Toasts:** `sonner`'s `toast()` for all async success/error feedback. The `<Toaster />`
must be mounted per route-group in `app/providers.tsx` (admin and portal each mount
their own) — a route group with no `<Toaster />` will silently swallow every
`toast.error()`/`toast.success()` call. Check this first if a toast "isn't showing."

## Accessibility baseline

- Every interactive element needs a visible `focus-visible` ring — the `Button`
  component provides this by default; hand-rolled `<button>` elements must add
  `outline-none focus-visible:ring-2 focus-visible:ring-ring/50` explicitly (easy to
  forget — audit any new raw `<button>` against this).
- Icon-only buttons: prefer `<Button variant="ghost" size="icon-xs">` over a bare
  `<button>` — consistent hit area and focus ring, no per-component reinvention.
- Body text must stay at 4.5:1 contrast against its background; `--muted-foreground`
  (`#6f655c`) on `--background`/`--card` already clears this — don't go lighter.

## Empty/loading/error states

Every async list (comments, CRM tables, portal cards) needs all three: a loading
label, a warm empty state (icon + a sentence with a next action, not a bare "No
results"), and a `toast.error(...)` on failure — never a silent no-op. See
`app/components/miembros/LessonComments.tsx` for the reference pattern.

## What NOT to do

- No purple/violet gradients, no 3-column icon-in-circle feature grids, no
  centered-everything, no decorative blobs/wavy dividers, no emoji as UI elements —
  none of this exists in the codebase today; keep it that way.
- No `Inter`/`Roboto`/`Arial`/bare `system-ui` as a primary typeface.
- No new color literal outside the tables above — add a CSS variable instead if a
  genuinely new one is needed, and explain why the existing palette doesn't cover it.
