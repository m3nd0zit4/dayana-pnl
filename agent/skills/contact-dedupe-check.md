---
description: Find likely duplicate contacts (same name or phone pattern) and propose which to merge — never merge automatically.
---

Use `search_contacts` with the name or phone fragment in question. If two contacts look like the same person (same phone digits, same name, or one is nameless and shows only its phone number as displayName), list both with their refs and say which one looks like the canonical record and why (more complete profile, has enrollments, older account) — a nameless contact isn't automatically the duplicate, but it's worth flagging as the one likely missing a merge.

There is no merge tool yet — present the comparison and let the operator do the merge by hand in `/admin/contacts`. Never delete or edit a contact to "merge" them yourself.
