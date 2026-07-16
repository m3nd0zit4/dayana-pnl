# Workshop Payment Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate `/taller-virtual/[slug]` behind "visitor is logged into the member portal AND has an ACTIVE Enrollment for that workshop's linked Product" — reusing the existing checkout, member-auth, and webhook infrastructure with no new payment provider, no new auth system, and no schema migration.

**Architecture:** `WorkshopEdition.productId` (already in the schema, currently dead-wired to a hardcoded fallback) becomes the real link into the existing `Product`/`ProductPrice` checkout catalog. The detail page becomes a server component that branches on an access check: unlocked renders the existing `WorkshopLanding` unchanged, locked renders a new stripped `WorkshopTeaser` with an inline checkout CTA reusing `PlanCheckoutButtons`. The two COURSE-only post-payment "create your portal account" paths (automated invite email + `/pago/exito` CTA) get broadened to also cover WORKSHOP, since without them a first-time workshop buyer has no way to log back in and pass the gate.

**Tech Stack:** Next.js 16 App Router, Prisma/Neon, NextAuth v5 (member session kind), existing PayPal/Mercado Pago checkout stack, Base UI components (`SearchableSelect`).

## Global Constraints

- No schema migration — `WorkshopEdition.productId` already exists (`prisma/schema.prisma:194`, optional FK to `Product`).
- No new auth mechanism — gating uses the existing `getMemberSession()` (`lib/auth/member-session.ts`) member-portal session, per the approved design doc.
- No new payment provider code — checkout reuses `getPlanFromDb`/`isActivePlanId` (`lib/plans-from-db.ts`) and `PlanCheckoutButtons` exactly as course/therapy purchases do today.
- **This repo has no automated test suite** (`package.json` has no `test` script, zero `*.test.ts(x)` files exist). Verification steps in this plan use the repo's real quality gates — `npm run typecheck`, `npm run lint`, and manual dev-server checks — instead of a fabricated unit-test cycle. Do not invent a test framework as part of this work.
- Design doc reference: `C:\Users\Julia\.gstack\projects\dayana-pnl\Julia-main-design-20260715-170009.md` (Status: APPROVED).

---

### Task 1: Fix `productId` persistence on `WorkshopEdition` (remove silent legacy fallback, fix PATCH)

**Context:** Today `POST /api/admin/workshops` silently connects every new workshop edition to the legacy seeded `"workshop-virtual"` product ($50 USD, one fixed edition from 2026) unless the caller explicitly passes a different `productId` — and `PATCH /api/admin/workshops/[slug]` doesn't even accept `productId` at all, so it can never be changed after creation. Both are bugs that predate this feature and must be fixed before wiring checkout to a specific workshop's real price.

**Files:**
- Modify: `lib/crm/workshop-editions.ts:1-95`
- Modify: `app/api/admin/workshops/route.ts:13-38` (the `toInput` mapper)
- Modify: `app/api/admin/workshops/[slug]/route.ts:35-58` (the PATCH handler)

**Interfaces:**
- Consumes: `WorkshopEditionInput.productId?: string | null` (already declared, `lib/crm/workshop-editions.ts:16`).
- Produces: `upsertWorkshopEdition(slug, input)` and `updateWorkshopEditionBySlug(slug, input)` now both persist `productId` (or leave it `null` if omitted) — no default fallback.

- [ ] **Step 1: Remove the fallback default in `toInput` (POST route)**

In `app/api/admin/workshops/route.ts`, change:
```ts
  productId: body.productId ?? "workshop-virtual",
```
to:
```ts
  productId: body.productId ?? null,
```

- [ ] **Step 2: Stop connecting a default product in `upsertWorkshopEdition`**

In `lib/crm/workshop-editions.ts`, change the `create` block inside `upsertWorkshopEdition`:
```ts
  return prisma.workshopEdition.upsert({
    where: { slug },
    create: {
      slug,
      status,
      ...editionData(enriched),
      product: {
        connect: { id: enriched.productId ?? "workshop-virtual" },
      },
    },
    update: {
      ...editionData(enriched),
      status,
    },
  });
```
to:
```ts
  return prisma.workshopEdition.upsert({
    where: { slug },
    create: {
      slug,
      status,
      ...editionData(enriched),
      ...(enriched.productId
        ? { product: { connect: { id: enriched.productId } } }
        : {}),
    },
    update: {
      ...editionData(enriched),
      status,
      ...(enriched.productId !== undefined
        ? enriched.productId
          ? { product: { connect: { id: enriched.productId } } }
          : { product: { disconnect: true } }
        : {}),
    },
  });
```

- [ ] **Step 3: Make `updateWorkshopEditionBySlug` persist `productId` too**

In `lib/crm/workshop-editions.ts`, change:
```ts
  return prisma.workshopEdition.update({
    where: { slug },
    data: {
      ...editionData(enriched),
      ...(enriched.status !== undefined ? { status: enriched.status } : {}),
    },
  });
```
to:
```ts
  return prisma.workshopEdition.update({
    where: { slug },
    data: {
      ...editionData(enriched),
      ...(enriched.status !== undefined ? { status: enriched.status } : {}),
      ...(enriched.productId !== undefined
        ? enriched.productId
          ? { product: { connect: { id: enriched.productId } } }
          : { product: { disconnect: true } }
        : {}),
    },
  });
```

- [ ] **Step 4: Pass `productId` through in the PATCH route**

In `app/api/admin/workshops/[slug]/route.ts`, inside the `updateWorkshopEditionBySlug(slug, { ... })` call, add:
```ts
    productId: parsed.data.productId,
```
(add it anywhere in the object literal, e.g. right after `status:`).

- [ ] **Step 5: Verify with typecheck**

Run: `npm run typecheck`
Expected: no new errors from these three files.

- [ ] **Step 6: Commit**

```bash
git add lib/crm/workshop-editions.ts app/api/admin/workshops/route.ts "app/api/admin/workshops/[slug]/route.ts"
git commit -m "fix(crm): stop silently linking new workshops to the legacy seed product"
```

---

### Task 2: Admin UI — let staff pick which Product a workshop charges

**Files:**
- Modify: `app/components/admin/crm/WorkshopFormModal.tsx`

**Interfaces:**
- Consumes: `useActiveProducts` (`app/components/admin/crm/hooks/useReferenceData.ts:44`, returns `{ products: ActiveProduct[], productsLoading: boolean }` where `ActiveProduct = { id, title, kind, isActive }`).
- Produces: `WorkshopRow.productId: string | null`, submit payload now includes `productId`.

- [ ] **Step 1: Add `productId` to `WorkshopRow` and `ApiEdition`**

In `app/components/admin/crm/WorkshopFormModal.tsx`, add `productId: string | null;` to both the `WorkshopRow` type (after line 44, `introOpen: string | null;`) and the `ApiEdition` type (same position), and add `productId: e.productId,` inside `mapApiEditionToRow`.

- [ ] **Step 2: Import the products hook and filter to WORKSHOP kind**

Add imports:
```ts
import { useActiveProducts } from "./hooks/useReferenceData";
```
Inside the `WorkshopFormModal` component body, after the existing `const { aiEnabled } = useCrm();` line, add:
```ts
  const { products } = useActiveProducts();
  const workshopProducts = products.filter((p) => p.kind === "WORKSHOP");
```

- [ ] **Step 3: Add `productId` state, hydrate it, reset it, include it in the payload**

Add state near the other `useState` calls:
```ts
  const [productId, setProductId] = useState<string>("");
```
In the `useEffect` hydration block, in the `if (edition)` branch add:
```ts
      setProductId(edition.productId ?? "");
```
and in the `else` (new-edition) branch add:
```ts
      setProductId("");
```
In `submit`, add to the `payload` object:
```ts
      productId: productId || undefined,
```

- [ ] **Step 4: Render the picker in the form**

Add this block right after the `SearchableSelect id="w-status"` / `editionLabel` grid (after the closing `</div>` of the `grid gap-4 sm:grid-cols-2` block, before `<StringListEditor`):
```tsx
        <div className="space-y-1.5">
          <SearchableSelect
            id="w-product"
            label="Producto vinculado (cobro)"
            value={productId}
            options={workshopProducts.map((p) => ({ value: p.id, label: p.title }))}
            onChange={setProductId}
            allowEmpty
            emptyLabel="Sin producto (solo WhatsApp, sin pago en línea)"
          />
          <p className="text-xs text-muted-foreground">
            Define el precio que se cobra al pagar en línea y qué compra
            desbloquea la página de este taller. Créalo primero en
            Productos si aún no existe (tipo &quot;Taller&quot;).
          </p>
        </div>
```

- [ ] **Step 5: Verify with typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no new errors.

- [ ] **Step 6: Manual verification**

Run: `bun dev`
In the browser: open `/admin/curso/... ` → workshops admin (or wherever `WorkshopsPageClient` is mounted), open "Nueva edición de taller", confirm the "Producto vinculado" dropdown appears and lists any existing `kind: WORKSHOP` products (create one first at the Products admin screen if none exist — title + USD price is enough). Save, reopen the edition, confirm the selection persisted.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/crm/WorkshopFormModal.tsx
git commit -m "feat(crm): let staff link a chargeable product to a workshop edition"
```

---

### Task 3: Workshop access-check helper

**Files:**
- Create: `lib/crm/workshop-access.ts`

**Interfaces:**
- Consumes: nothing new — `prisma` from `lib/db.ts`, `EnrollmentStatus` from `@prisma/client`.
- Produces: `hasActiveWorkshopEnrollment(contactId: string, productId: string): Promise<boolean>` — used by Task 6 (page gating).

- [ ] **Step 1: Write the helper**

```ts
import { EnrollmentStatus } from "@prisma/client";
import { prisma } from "../db";

/**
 * True if this contact has a paid, active purchase of the given Product —
 * the same status model course/therapy checkout already uses. Keyed on
 * Product, not WorkshopEdition, matching how checkout is keyed throughout
 * the codebase (see lib/plans-from-db.ts).
 */
export const hasActiveWorkshopEnrollment = async (
  contactId: string,
  productId: string
): Promise<boolean> => {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      contactId,
      productId,
      status: EnrollmentStatus.ACTIVE,
    },
    select: { id: true },
  });
  return enrollment !== null;
};
```

- [ ] **Step 2: Verify with typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/crm/workshop-access.ts
git commit -m "feat(crm): add workshop access-check helper for the payment gate"
```

---

### Task 4: Thread `id` and `productId` through the workshop data layer

**Files:**
- Modify: `lib/workshop-edition-mapper.ts`
- Modify: `lib/workshops.ts` (the `WorkshopDetail` type only)
- Modify: `lib/workshops-db.ts` (`editionSelect`)

**Interfaces:**
- Produces: `WorkshopDetail.id: string`, `WorkshopDetail.productId: string | null` — consumed by Task 6 (page) and Task 5 (teaser).

- [ ] **Step 1: Add the fields to `WorkshopDetail`**

In `lib/workshops.ts`, inside the `WorkshopDetail` type (starts at `export type WorkshopDetail = WorkshopCard & {`), add two fields:
```ts
export type WorkshopDetail = WorkshopCard & {
  id: string;
  productId: string | null;
  heroLines: [string, string, string];
  // ...unchanged fields below
```

- [ ] **Step 2: Add `id` and `productId` to the Prisma select + record type**

In `lib/workshop-edition-mapper.ts`, add `"id"` and `"productId"` to the `WorkshopEditionRecord` Pick union:
```ts
export type WorkshopEditionRecord = Pick<
  WorkshopEdition,
  | "id"
  | "slug"
  | "title"
  | "editionLabel"
  | "cardSummary"
  | "status"
  | "dateLabel"
  | "scheduleLabel"
  | "whatsappTemplate"
  | "heroLine1"
  | "heroLine2"
  | "heroLine3"
  | "detailSummary"
  | "intro"
  | "focusTopics"
  | "daySchedule"
  | "topicsSectionTitle"
  | "topicsSectionDescription"
  | "scheduleSectionDescription"
  | "metaTitle"
  | "metaDescription"
  | "introOpen"
  | "productId"
>;
```

- [ ] **Step 3: Set the new fields in `mapEditionToDetail`**

In `lib/workshop-edition-mapper.ts`, inside `mapEditionToDetail`'s returned object, add:
```ts
  return {
    ...card,
    id: edition.id,
    productId: edition.productId,
    heroLines,
    // ...unchanged fields below
```

- [ ] **Step 4: Select the new columns in `workshops-db.ts`**

In `lib/workshops-db.ts`, add `id: true,` and `productId: true,` to the `editionSelect` object (anywhere in the object; alphabetical position isn't load-bearing since it's a `satisfies` check against `WorkshopEditionRecord`).

- [ ] **Step 5: Verify with typecheck**

Run: `npm run typecheck`
Expected: no errors — `editionSelect` must still satisfy `Record<keyof WorkshopEditionRecord, true>`, which is exactly why Steps 2 and 4 both had to change together.

- [ ] **Step 6: Commit**

```bash
git add lib/workshops.ts lib/workshop-edition-mapper.ts lib/workshops-db.ts
git commit -m "feat(workshops): thread edition id + productId through to WorkshopDetail"
```

---

### Task 5: `WorkshopTeaser` — the locked view with inline checkout

**Files:**
- Create: `app/components/home/WorkshopTeaser.tsx`

**Interfaces:**
- Consumes: `WorkshopDetail` (from `lib/workshops.ts`), `Plan` (from `lib/plans.ts`), `PlanCheckoutButtons` (`app/components/payments/PlanCheckoutButtons.tsx`, props `{ plan: Plan; isDark: boolean; userCountry?: string | null }`).
- Produces: `WorkshopTeaser` component, rendered by Task 6 when the visitor lacks access. Renders title/edition/date/summary only — no `focusTopics`, no `daySchedule`, no `detailSummary`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import Link from "next/link";
import type { WorkshopDetail } from "../../../lib/workshops";
import type { Plan } from "../../../lib/plans";
import PlanCheckoutButtons from "../payments/PlanCheckoutButtons";
import WhatsAppButton from "../ui/WhatsAppButton";

type WorkshopTeaserProps = {
  workshop: WorkshopDetail;
  plan: Plan | null;
  userCountry?: string | null;
};

const WorkshopTeaser = ({ workshop, plan, userCountry }: WorkshopTeaserProps) => {
  return (
    <section className="bg-[#faf7f2] text-black min-h-screen">
      <div className="px-3 lg:px-8 pt-24 lg:pt-28 pb-16 max-w-[1400px] mx-auto">
        <Link
          href="/taller-virtual"
          className="inline-flex items-center gap-2 font-[font2] text-[10px] uppercase tracking-[0.25em] text-black/55 transition-colors hover:text-black"
        >
          <span aria-hidden>←</span>
          Todos los talleres
        </Link>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-black/15 px-4 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.25em]">
            Taller virtual
          </span>
        </div>

        <h1 className="mt-7 font-[font2] text-[13vw] md:text-[9vw] lg:text-[6vw] uppercase leading-[0.92]">
          {workshop.title}
        </h1>

        <article className="mt-10 rounded-3xl border border-black/15 bg-white p-7 lg:p-10 shadow-[0_24px_60px_rgba(0,0,0,0.06)]">
          <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-black/55">
            {workshop.editionLabel}
          </div>
          <p className="font-[font1] mt-4 max-w-2xl text-base lg:text-lg leading-snug text-black/72">
            {workshop.cardSummary}
          </p>
          <div className="mt-6 rounded-2xl border border-black/12 bg-[#faf7f2] px-5 py-4">
            <div className="font-[font1] text-xl leading-tight">
              {workshop.dateLabel}
            </div>
            <div className="font-[font1] text-sm text-black/60">
              {workshop.scheduleLabel}
            </div>
          </div>
        </article>

        <article className="mt-10 rounded-3xl border border-black/10 bg-black text-white p-7 lg:p-10">
          <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
            Inscripción
          </div>
          <p className="font-[font1] mt-4 text-white/82 leading-snug max-w-2xl text-lg">
            El programa completo se desbloquea al confirmar tu pago. Ya
            pagaste e iniciaste sesión y no ves el contenido? Escríbenos.
          </p>

          {plan ? (
            <PlanCheckoutButtons plan={plan} isDark userCountry={userCountry} />
          ) : (
            <p className="mt-6 text-sm text-white/60">
              El pago en línea para este taller aún no está configurado.
            </p>
          )}

          <div className="mt-4">
            <WhatsAppButton
              message={workshop.whatsappMessage}
              label="Consultar por WhatsApp"
              size="lg"
              className="w-full"
            />
          </div>
        </article>
      </div>
    </section>
  );
};

export default WorkshopTeaser;
```

- [ ] **Step 2: Verify with typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. (`WhatsAppButton.message` is `string`, `WorkshopDetail.whatsappMessage` is also `string` — no null-handling needed here.)

- [ ] **Step 3: Commit**

```bash
git add app/components/home/WorkshopTeaser.tsx
git commit -m "feat(workshops): add locked-state teaser with inline checkout CTA"
```

---

### Task 6: Gate the page

**Files:**
- Modify: `app/taller-virtual/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getMemberSession` (`lib/auth/member-session.ts`), `hasActiveWorkshopEnrollment` (Task 3), `getPlanFromDb` (`lib/plans-from-db.ts`), `getServerUserCountry` (`lib/geo/user-country.ts`), `WorkshopTeaser` (Task 5).

- [ ] **Step 1: Rewrite the page component**

Replace the full contents of `app/taller-virtual/[slug]/page.tsx` with:
```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkshopLanding from "@/app/components/home/WorkshopLanding";
import WorkshopTeaser from "@/app/components/home/WorkshopTeaser";
import Footer from "@/app/components/home/Footer";
import FloatingWhatsApp from "@/app/components/ui/FloatingWhatsApp";
import { getOpenWorkshopDetailBySlug } from "@/lib/workshops-db";
import { getMemberSession } from "@/lib/auth/member-session";
import { hasActiveWorkshopEnrollment } from "@/lib/crm/workshop-access";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { getServerUserCountry } from "@/lib/geo/user-country";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const workshop = await getOpenWorkshopDetailBySlug(slug);
  if (!workshop) return { title: "Taller no encontrado" };
  return {
    title: workshop.metadata.title,
    description: workshop.metadata.description,
  };
}

const WorkshopDetailPage = async ({ params }: PageProps) => {
  const { slug } = await params;
  const workshop = await getOpenWorkshopDetailBySlug(slug);
  if (!workshop) notFound();

  let hasAccess = false;
  if (workshop.productId) {
    const member = await getMemberSession();
    if (member) {
      hasAccess = await hasActiveWorkshopEnrollment(
        member.contact.id,
        workshop.productId
      );
    }
  } else {
    // No product linked yet — nothing to pay for, so there's nothing to
    // gate; behave like today (fully public, WhatsApp-only).
    hasAccess = true;
  }

  const [plan, userCountry] = workshop.productId
    ? await Promise.all([
        getPlanFromDb(workshop.productId),
        getServerUserCountry(),
      ])
    : [null, null];

  return (
    <>
      <main>
        {hasAccess ? (
          <WorkshopLanding workshop={workshop} />
        ) : (
          <WorkshopTeaser workshop={workshop} plan={plan} userCountry={userCountry} />
        )}
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default WorkshopDetailPage;
```

- [ ] **Step 2: Verify with typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. If `getServerUserCountry` throws outside a request context or requires different handling, check its existing usage in `lib/pricing/public-plans.ts:20` for the correct call shape.

- [ ] **Step 3: Manual verification — the full loop**

1. Run: `bun dev`
2. In the CRM admin, ensure a `WorkshopEdition` with `status: OPEN` has a linked `productId` (from Task 2) pointing at a `kind: WORKSHOP` Product with a real USD price.
3. Visit `/taller-virtual/<that-slug>` in a private/incognito window (no member session) → confirm you see `WorkshopTeaser` (title/date/summary + pay button), not the full `WorkshopLanding`.
4. Complete a real or sandbox PayPal/Mercado Pago checkout for that product from the teaser's `PlanCheckoutButtons`.
5. After payment success, confirm `/pago/exito` shows a "crear tu cuenta" CTA (this needs Task 7 to render correctly for a WORKSHOP purchase — do Task 7 before this manual check, or expect course-specific copy here until then).
6. Create the member account via that CTA, then revisit `/taller-virtual/<slug>` — confirm you now see the full `WorkshopLanding`.
7. Visit an edition with no `productId` linked — confirm it renders exactly as before (full `WorkshopLanding`, no teaser), matching today's behavior for workshops that haven't opted into online payment yet.

- [ ] **Step 4: Commit**

```bash
git add "app/taller-virtual/[slug]/page.tsx"
git commit -m "feat(workshops): gate the detail page behind payment + member login"
```

---

### Task 7: Extend post-payment member-portal onboarding to WORKSHOP purchases

**Context:** The automated "create your portal account" invite email, and the `/pago/exito` CTA that offers it, currently only fire for `ProductKind.COURSE`. Without this, a first-time workshop buyer has no way to discover they need a member account, and Task 6's gate would strand them forever on the teaser after paying.

**Files:**
- Modify: `lib/inngest/functions.ts:46-89`
- Modify: `app/pago/exito/page.tsx:212-242` and `app/pago/exito/page.tsx:391-421`

**Interfaces:**
- No new exports — broadens existing kind checks from `=== ProductKind.COURSE` to `COURSE or WORKSHOP`, and adds kind-aware copy where the rendered text currently assumes "course" (recordings/modules language).

- [ ] **Step 1: Split the membership-extension step from the invite step**

In `lib/inngest/functions.ts`, change:
```ts
    if (enrollment.product.kind === ProductKind.COURSE) {
      // Safety net for extensions recordPayment swallowed (idempotent —
      // membershipAppliedAt marks payments already counted).
      await step.run("ensure-membership-extension", async () => {
        const pending = await prisma.payment.findMany({
          where: {
            enrollmentId,
            status: PaymentStatus.APPROVED,
            membershipAppliedAt: null,
          },
          select: { id: true },
        });
        let extended = 0;
        for (const payment of pending) {
          const result = await applyMembershipExtension(payment.id);
          if (result.extended) extended += 1;
        }
        return { pending: pending.length, extended };
      });

      await step.run("member-portal-invite", async () => {
        const contact = await prisma.contact.findUnique({
          where: { id: enrollment.contactId },
          select: {
            id: true,
            email: true,
            firstName: true,
            memberAccount: { select: { id: true } },
          },
        });
        if (!contact?.email) return { skipped: "no_email" };
        if (contact.memberAccount) return { skipped: "has_account" };

        const rawToken = await createMemberAuthToken({
          contactId: contact.id,
          purpose: "INVITE",
        });
        const { result } = await sendMemberInviteEmail({
          contactId: contact.id,
          firstName: contact.firstName,
          rawToken,
        });
        return { status: result.status };
      });
    }
```
to:
```ts
    if (enrollment.product.kind === ProductKind.COURSE) {
      // Safety net for extensions recordPayment swallowed (idempotent —
      // membershipAppliedAt marks payments already counted).
      await step.run("ensure-membership-extension", async () => {
        const pending = await prisma.payment.findMany({
          where: {
            enrollmentId,
            status: PaymentStatus.APPROVED,
            membershipAppliedAt: null,
          },
          select: { id: true },
        });
        let extended = 0;
        for (const payment of pending) {
          const result = await applyMembershipExtension(payment.id);
          if (result.extended) extended += 1;
        }
        return { pending: pending.length, extended };
      });
    }

    if (
      enrollment.product.kind === ProductKind.COURSE ||
      enrollment.product.kind === ProductKind.WORKSHOP
    ) {
      // Member-portal access is shared by courses and paid workshops —
      // both need the buyer to be able to log into /miembros to view
      // gated content.
      await step.run("member-portal-invite", async () => {
        const contact = await prisma.contact.findUnique({
          where: { id: enrollment.contactId },
          select: {
            id: true,
            email: true,
            firstName: true,
            memberAccount: { select: { id: true } },
          },
        });
        if (!contact?.email) return { skipped: "no_email" };
        if (contact.memberAccount) return { skipped: "has_account" };

        const rawToken = await createMemberAuthToken({
          contactId: contact.id,
          purpose: "INVITE",
        });
        const { result } = await sendMemberInviteEmail({
          contactId: contact.id,
          firstName: contact.firstName,
          rawToken,
        });
        return { status: result.status };
      });
    }
```

- [ ] **Step 2: Broaden the `/pago/exito` CTA computation**

In `app/pago/exito/page.tsx`, change:
```ts
        if (enrollment.product.kind === ProductKind.COURSE) {
          const member = await getMemberByContactId(enrollment.contactId);
          const hasAccess =
            member?.account?.passwordHash || member?.account?.googleSub;
          coursePortal = hasAccess ? "account" : "invite";
        }
```
to:
```ts
        if (
          enrollment.product.kind === ProductKind.COURSE ||
          enrollment.product.kind === ProductKind.WORKSHOP
        ) {
          const member = await getMemberByContactId(enrollment.contactId);
          const hasAccess =
            member?.account?.passwordHash || member?.account?.googleSub;
          coursePortal = hasAccess ? "account" : "invite";
          portalKind = enrollment.product.kind;
        }
```
Just above this block (where `coursePortal` is declared), add a sibling variable:
```ts
  let postPaymentMode: "none" | "legacy" | "email-only" = "none";
  let coursePortal: "invite" | "account" | null = null;
  let portalKind: "COURSE" | "WORKSHOP" | null = null;
```
(replacing the existing two-line declaration with this three-line one).

- [ ] **Step 3: Make the rendered copy kind-aware**

In `app/pago/exito/page.tsx`, change the invite-copy paragraph:
```tsx
                <p className="font-[font1] text-white/80 text-sm lg:text-base leading-relaxed mb-5">
                  Te enviamos un correo para crear tu cuenta del portal de
                  miembros: ahí encontrarás el enlace de las clases en vivo,
                  las grabaciones y los módulos del curso.
                </p>
```
to:
```tsx
                <p className="font-[font1] text-white/80 text-sm lg:text-base leading-relaxed mb-5">
                  {portalKind === "WORKSHOP"
                    ? "Te enviamos un correo para crear tu cuenta del portal de miembros: con ella podrás volver a entrar a la página completa de tu taller cuando quieras."
                    : "Te enviamos un correo para crear tu cuenta del portal de miembros: ahí encontrarás el enlace de las clases en vivo, las grabaciones y los módulos del curso."}
                </p>
```
and the account-copy paragraph:
```tsx
                <p className="font-[font1] text-white/80 text-sm lg:text-base leading-relaxed mb-5">
                  Tu mensualidad quedó al día. Entra al portal para ver las
                  próximas clases, grabaciones y módulos.
                </p>
```
to:
```tsx
                <p className="font-[font1] text-white/80 text-sm lg:text-base leading-relaxed mb-5">
                  {portalKind === "WORKSHOP"
                    ? "Ya tienes cuenta del portal. Entra para ver la página completa de tu taller."
                    : "Tu mensualidad quedó al día. Entra al portal para ver las próximas clases, grabaciones y módulos."}
                </p>
```

- [ ] **Step 4: Verify with typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Complete Task 6 Step 3's manual walkthrough end-to-end now that this task is done — confirm the `/pago/exito` copy after a workshop purchase reads the workshop-specific text, not the course-specific text, and that the invite email still sends (check `NOTIFICATIONS_DRY_RUN`/`NOTIFICATIONS_ENABLED` env vars per `CLAUDE.md` if it doesn't appear to send in your local environment).

- [ ] **Step 6: Commit**

```bash
git add lib/inngest/functions.ts app/pago/exito/page.tsx
git commit -m "feat(workshops): extend member-portal onboarding to workshop buyers"
```

---

## Post-implementation notes (not tasks — context for whoever picks this up)

- **Verified, no action needed:** `getPublicPlans()`'s `allPlans` (which would include WORKSHOP-kind products) is never consumed by any public-facing page — only `therapyPlans` and `coursePlan` reach `/servicios`, `/`, and `/miembros/cuenta` via `getVisiblePublicPlans()` (`lib/pricing/public-plans.ts`), and that function explicitly never returns `allPlans`. Wiring workshop products into checkout does not leak them into the general pricing catalog.
- **Deferred, per the design doc's open questions:** staff-side manual "mark as paid" override for cash/bank-transfer workshop buyers was not decided in the office-hours session — if that's still needed, it likely already works today via the existing generic manual-payment-entry flow (`markEnrollmentPaid` in `lib/crm/enrollments.ts`, same one course/therapy use), since nothing in this plan removes that path. Confirm with the user before assuming it's sufficient.
- **Follow-up idea, explicitly out of scope:** Approach B from the design doc (workshop content living inside the `/miembros` portal shell with its own nav entry) is the natural next step once workshops need real post-purchase content beyond what's already on `WorkshopLanding` (join links, materials, recordings).
