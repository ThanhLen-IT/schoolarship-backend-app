# Mentor BE-07: access control and API integration

## Schema reference
Checked against `Database-v1.0`:
- `users.role`, `users.is_mentor`, `users.is_active`
- `mentor_verifications` (`user_id`, `status`, `admin_note`, `evidence_file_url`, `scholarship_id`, `hourly_rate`, `calendly_link`, `qr_payment_url`)
- `mentor_reviews` (`mentor_id`, `mentee_id`, **required** `application_id`, `rating`, `comment`)
- `mentee_applications` (`mentee_id`, `mentor_id`, `status`)

No SQL schema migration is required for this change.

## Security changes
- JWT verification now fetches the current account state from PostgreSQL each authenticated request.
- Inactive users are blocked. Revoking `admin` or `mentor` in DB takes effect immediately instead of waiting for token expiration.
- `PATCH /api/users/mentor-status` deliberately responds **403**; a user cannot grant themselves mentor rights.
- Public Mentor search/detail returns only currently active, approved accounts with `role='mentor'` and `is_mentor=true`.
- Review API requires a linked application owned by the current mentee and aimed at the specified mentor.
- A review can be created only if application status is **`completed`** (a future application/session workflow must set this status). Only one review per application is accepted by the API.
- Positive reviews award XP only after successful review insertion, inside the same DB transaction.
- Mentor evidence PDFs are stored in private `uploads/` and are NOT served by `express.static`. Files are validated by MIME and PDF header; admin-only download uses a strict filename whitelist.

## Endpoints (user)
| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/api/mentors` | Public; optional `search`, `scholarship_id`, `page`, `limit` |
| GET | `/api/mentors/:id` | Public; approved mentor only |
| GET | `/api/mentors/verify/status` | JWT user; own application |
| POST | `/api/mentors/verify` | JWT user; multipart PDF `evidence_file`; optional `scholarship_id`, `hourly_rate`, `calendly_link`, `qr_payment_url` |
| POST | `/api/mentors/:id/reviews` | JWT mentee; JSON `{ "application_id": 1, "rating": 5, "comment": "..." }` |
| PATCH | `/api/users/mentor-status` | JWT user; **deprecated / 403** |

## Endpoints (admin only)
| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/admin/mentors/verifications?status=pending&page=1&limit=20` | List; status may be `pending`, `approved`, `rejected`, `all` |
| GET | `/api/admin/mentors/verifications/:id/evidence` | Private PDF download |
| PATCH | `/api/admin/mentors/verifications/:id/approve` | Approve a pending application; atomically grants `role='mentor'`, `is_mentor=true` |
| PATCH | `/api/admin/mentors/verifications/:id/reject` | Reject a pending application |
Both PATCH endpoints accept optional JSON body `{ "admin_note": "..." }`.

## Manual tests before merge
1. Ensure `npm ci` succeeds and `node --check src/app.js` works with supported Node.js version.
2. Log in as a normal user and call legacy `PATCH /api/users/mentor-status`: expect **403** and no change in `users.role`.
3. Submit a small PDF via `POST /api/mentors/verify`: expect **201**; submit again: expect **409**.
4. Verify direct public URLs beginning with `/uploads/` do not serve private evidence.
5. Log in as Admin and list pending verifications; download the evidence using the admin-only endpoint.
6. Approve one application: expect user `role='mentor'`, `is_mentor=true`, public Mentor detail visible.
7. Deny a second application: expect user role unchanged and no Mentor listing.
8. With an old JWT issued before approval or revocation, verify the current **DB role** is enforced.
9. Try a review with someone else's `application_id`: expect **403** and no XP.
10. Try a review for an application with `status='pending'`: expect **409**.
11. After an application is marked `completed`, create one review and try repeating it: first **201**, next **409**.
12. Verify user-facing UI handles `avg_rating = null` when a Mentor has no reviews, rather than showing an invented 5.0.

## Deployment
Locally stored evidence files will not be stored in Git. Back up and persist `uploads/`, or move files to a private object store (for example S3 with signed/admin-authorized downloads) before deploying to ephemeral environments.
Admin Web UI and Android client must be updated to call these new endpoints. No live PostgreSQL integration test was performed as part of this change.
