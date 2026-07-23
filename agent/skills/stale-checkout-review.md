---
description: Review enrollments stuck in PENDING_PAYMENT or LEAD and summarize which ones need operator attention.
---

Use `list_enrollments` filtered by `status: "PENDING_PAYMENT"` and separately `status: "LEAD"`. For each result older than a few days, note the contact and product. Group by how long they've been stuck (use the enrollment's ref to let the operator open it).

You cannot resend a checkout link, apply a promo code, or email the customer yet — those tools don't exist in this phase. Summarize what you found and suggest the operator act from the `/admin/enrollments` or `/admin/payments` page. Don't invent a workaround.
