# CLS fixes (May 2026)

Cumulative Layout Shift mitigations applied across the site:

## Media

- **Home hero** (`HomeHero.tsx`): `width`/`height` on poster image and video; `fetchPriority="high"` on poster; media wrapper uses `min-h-full min-w-full` so poster→video swap does not resize the hero.
- **Testimonials** (`TestimonialsSection.tsx`): YouTube thumbnails use explicit `480×360`; iframe mounts only after play (facade pattern) inside a fixed `aspect-video` container so empty iframes do not affect layout.

## Fonts

- **`globals.css`**: `font-display: swap` on custom faces (unchanged).
- **`layout.tsx`**: Preload `Lausanne-300` and `Lausanne-500` woff2 to reduce FOIT/FOUT text reflow.

## Intro / motion

- **`Stairs.tsx`**: Skip stair intro when `prefers-reduced-motion: reduce`; fail-safe still forces visible content.
- **`globals.css`**: `.stairs-page-content` forced to `opacity: 1` under reduced motion so the page is not stuck invisible before JS runs.

## Workshops listing

- Removed detail-page links and CTA buttons that changed card height by status; upcoming card uses a static “Próximamente” pill (consistent card footprint).

## How to verify

1. `npm run build` — production build must pass.
2. Chrome DevTools → **Performance** → record load + scroll on `/` and `/taller-virtual`; check **Experience** / **Layout shifts** in the trace.
3. [PageSpeed Insights](https://pagespeed.web.dev/) or Lighthouse (mobile): compare **CLS** before/after; focus on hero, testimonial grid, and first navigation paint.
4. Optional: enable **Layout Shift Regions** in DevTools Rendering tab while scrolling testimonials and home sections.
