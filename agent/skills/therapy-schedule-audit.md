---
description: Find active therapy packages with unscheduled or overdue sessions.
---

Use `list_enrollments` with `status: "ACTIVE"` to find therapy enrollments, then `get_therapy_package` on each to see session status. Flag packages where the next session is `PENDING_SCHEDULE` with no `scheduledAt`, or where a `SCHEDULED` session's date has already passed (offer to mark it `NO_SHOW` or reschedule — ask which, don't assume).

If the operator confirms a fix, use `schedule_therapy_session`, `mark_therapy_session_no_show`, or `update_therapy_session` as appropriate — one session at a time, confirming which session number before acting if there's any ambiguity.
