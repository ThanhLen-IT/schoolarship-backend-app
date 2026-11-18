# Mobile completion — deploy and API contract

This branch includes the earlier user-activity logger. It adds real avatar uploads,
mentoring CVs, chat, in-app notifications, support tickets and account closure.
Existing public/auth routes remain available. Apply the migration before deploying
the matching Android `feat/mobile-completion` branch.

## EC2 deployment

Use Node >=20.9 (required by image processing). The existing Database-v1.0 base
schema must already exist. Do not replace or drop the database.

```bash
cd ~/apps/schoolarship-backend-app
node --version
git fetch origin
git switch feat/mobile-completion
npm ci --omit=dev
npm run migrate:mobile && sudo systemctl restart scholarship-api.service
sudo systemctl status scholarship-api.service --no-pager
sudo journalctl -u scholarship-api.service -n 50 -f -o cat
```

`migrate:mobile` applies the existing ranking/study-level migrations and then
`20261111_mobile_completion.sql`, followed by `20261111_crawler_status_width.sql`
to accommodate the crawler's 21-character `completed_with_errors` state. It can be run again; no existing tables are
dropped. The new migration adds message idempotency/cursor indexes and transactional
notifications for mentoring/verification changes. It does not create demo accounts.
Normal journal retention and the existing email sender configuration still apply.

For an isolated demo/test database, see [DEMO_DATASET.md](DEMO_DATASET.md).
`npm run seed:demo` supplies synthetic admin/mobile scenarios; it is separate from
startup and migration, and never runs automatically in the API service.

Uploaded avatars are re-encoded into `media/avatars/`. Keep that runtime directory
and the private `uploads/` directory when deploying/backing up the instance.
`PUBLIC_BASE_URL` defaults to `https://scholarship-uit.duckdns.org`; configure the
actual HTTPS public origin if using another domain. NGINX must proxy `/api/` and
`/media/avatars/` to Express. **Never make `uploads/` a public static directory.**
If NGINX already proxies `/`, no extra location is needed. Otherwise add:

```nginx
location /media/avatars/ {
    proxy_pass http://127.0.0.1:5000;
}
```

This repository change does not update EC2 or NGINX by itself. After deployment,
verify `/health/midterm`, sign in on the Android app and follow request logs.

## New endpoints

All responses use `{success,data}` and collection paging uses
`page,limit,total,totalPages`. All endpoints below except filters/avatar delivery
require the existing Bearer JWT middleware (current active account checked in DB).

| Method / path | Body / behavior |
| --- | --- |
| GET `/api/scholarships/filters` | Published records only; `data:{countries,types,majors,study_levels}` arrays |
| POST `/api/users/avatar` | Multipart `avatar`, JPEG/PNG/WebP <=5MB; decoded, EXIF-rotated, resized/re-encoded to WebP; returns `data.avatar_url` and updates profile immediately |
| GET `/media/avatars/:file` | Public UUID avatar only; no arbitrary paths or evidence files |
| POST `/api/mentoring/applications/with-cv` | Multipart `mentor_id,scholarship_id,introduction,cv` (PDF <=5MB); same mentor/duplicate validation as JSON application route |
| GET `/api/mentoring/applications/:id/cv` | Only that application's mentee/mentor; private PDF, or redirect for legacy external CV URL |
| GET `/api/chat/conversations` | Own active contacts, latest message and unread count; paginated |
| POST `/api/chat/conversations` | `{participant_id}`; requires an accepted/in-progress/completed mentoring relationship; returns existing or new pair conversation |
| GET `/api/chat/conversations/:id/messages` | Member only; `limit<=100`, optional `before_id` OR `after_id`, chronological `data`, boolean `has_more` |
| POST `/api/chat/conversations/:id/messages` | `{message,client_message_id}`; 1–4000 characters, UUID retry key; same UUID/sender/conversation returns original message without another notification |
| PATCH `/api/chat/conversations/:id/read` | `{through_id}`; read only incoming messages up to displayed ID and corresponding chat notices |
| GET `/api/notifications` | Own notices, paging and `unread_count` |
| PATCH `/api/notifications/:id/read` | Own notice only |
| PATCH `/api/notifications/read-all` | Own notices only |
| POST `/api/support/tickets` | `{subject,message}` (1–255 / 1–5000 characters) |
| GET `/api/support/tickets` | Own tickets, status and admin replies; paginated |
| GET `/api/admin/support/tickets` | Admin only, paginated support inbox |
| PATCH `/api/admin/support/tickets/:id/reply` | Admin only `{response}`; resolve ticket and notify its owner atomically |
| DELETE `/api/users/me` | `{current_password}`; re-authentication and account closure below |

Mentoring list responses now include `viewer_role`, mentor/mentee IDs/names and
introduction. The Android client can call existing progress, response-request and
review APIs instead of fabricating transitions. A concrete study-level filter also
matches scholarships explicitly marked for all study levels.

## Notifications and chat semantics

Notifications are stored in the existing notifications table. New messages, new
mentoring applications, progress changes, verification decisions and support replies
produce notices. Message/notification writes share one SQL transaction; admin support
replies use one modifying CTE. Android chat polls every 5 seconds **while visible**,
loads history by cursor and pauses polling offscreen. These are in-app notifications,
not FCM/system push. Chat is separate from explicit response requests used to measure
ranking response rate: ordinary chat messages do not inflate ranking metrics.

## Account closure

This API closes and anonymizes the account instead of hard-deleting IDs referenced
by mentoring/payment history. It requires the correct current password. Admin accounts
cannot close themselves through this endpoint. Existing JWTs stop working because
middleware checks `is_active` each time (`403`, code `ACCOUNT_INACTIVE`). Android clears
the session for that code, while ordinary permission-denied responses keep the session.

Profile/credentials/reset tokens are erased or replaced, own posts/comments/bookmarks,
conversations/messages, notifications and support tickets are removed. Active mentoring
applications become `cancelled`; retained history uses an anonymized user record. Own
CV introductions/file references and verification document/service links are cleared.
Recognizable files created by this service for the closing user are removed after the
transaction commits. Legacy files hosted on other services cannot be deleted here.
Previously downloaded copies or cached images on another device are outside this API.

## Verification

`npm test` includes the existing tests plus real HTTP tests running against PostgreSQL
18.6 through PGlite, using a schema-only fixture from Database-v1.0 (no personal data).
These cover migration reruns, published filters, CV access, real mentoring transitions,
chat authorization/idempotency/read state, notification ownership, support/admin replies,
image re-encoding/rejection and account re-authentication/session invalidation. Production
PostgreSQL, real email delivery and production NGINX/storage must still be checked after
deploy. No live users or real database contents were modified by these tests.

Final check: 57 backend tests passed. No production account or database was changed.
