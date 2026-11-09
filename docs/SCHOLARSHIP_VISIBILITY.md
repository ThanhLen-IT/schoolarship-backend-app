# Scholarship visibility & lifecycle — API behavior

Compared with the `scholarships` and `saved_scholarships` tables in `Database-v1.0`.

## API behavior
- `GET /api/scholarships` / `GET /api/scholarships/:id` return published scholarships only.
- `POST /api/users/saved/:scholarshipId` only saves a published scholarship. Unpublished/not found: 404. Saving the same published scholarship twice remains idempotent (200).
- `GET /api/users/saved` hides saved scholarships that were later rejected/archived or are no longer published.
- `PATCH /api/admin/scholarships/:id/approve`: only `pending -> published` is accepted.
- `PATCH /api/admin/scholarships/:id/reject`: only `pending -> rejected` is accepted.
- `PATCH /api/admin/scholarships/:id/archive`: only `published -> archived` is accepted.
- Invalid status transition: 409, missing scholarship: 404.
- Invalid `study_level` on public search returns 400 rather than 500.

Admin workflow note: re-publishing an archived or rejected scholarship requires a separate deliberate state-reset/review workflow. Do not bypass status restrictions by direct database edits without auditing.

## Manual regression tests
1. As unauthenticated user, query published list and confirm no pending/rejected/archived results.
2. `GET /api/scholarships?study_level=bad-value` -> HTTP 400.
3. As logged-in user, attempt to save a pending/rejected/archived scholarship -> HTTP 404.
4. Save a published scholarship twice -> both requests HTTP 200; only one row in `saved_scholarships`.
5. Change a saved scholarship from published to archived via Admin; confirm it disappears from `GET /api/users/saved`.
6. Approve a pending scholarship -> HTTP 200; re-approve the same scholarship -> 409.
7. Reject a pending scholarship -> 200; reject a published scholarship -> 409.
8. Archive a published scholarship -> 200; archive a pending scholarship -> 409.
9. Try an ID that does not exist -> 404; try `/api/admin/scholarships/not-an-id/approve` -> 400.

## Remaining work
- Validate `original_content_html` / `content_html` publication and sanitization policies.
- Tighten date/length/multiselect payload validation and pagination in Admin Crawler endpoints.
- Build a controlled re-review flow for records that need to transition back to pending.
- Add integration tests against PostgreSQL.

This change does **not** modify database schema, user roles, crawler services, or existing route URLs.
