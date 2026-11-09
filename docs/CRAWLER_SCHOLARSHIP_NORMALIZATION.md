# Crawler, scholarship moderation, and mobile HTML safety

Reference schema: `Database-v1.0` (`scholarships`, `scholarship_crawl_logs`).
This PR changes API/controller/service logic; it does **not** automatically migrate PostgreSQL.

## Study-level normalization
Mobile uses `study_levels: text[]` containing:
`bachelor`, `master`, `doctoral`, `all`, `other`, `unknown`.
YBOX sources now store `bachelor` / `master` / `doctoral` / `other`.
Existing Admin input `Cử nhân`, `Thạc sĩ`, `Tiến sĩ`, `Trao đổi ngắn hạn`
is accepted and mapped to the same canonical values before saving.

Previously published scholarships might have noncanonical legacy levels.
Run `migrations/20261110_normalize_scholarship_study_levels.sql` **manually after a DB backup**
if those records exist. The script is idempotent for the listed legacy values.
It does not change the status of any scholarship.

## HTML content and approval
- Crawler preserves fetched article markup in `original_content_html` **for Admin only**.
- It creates `content_html` with restricted HTML tags, no event handlers, and only
  HTTP(S) image/link URLs. Scripts, forms, iframes, SVG and other executable tags are removed.
- Admin can update `content_html` (as a text/html string) using either
  `PUT /api/admin/crawler/scholarships/:id` or `PUT /api/admin/scholarships/:id`.
  `POST /api/admin/scholarships` also accepts `content_html`.
- Both Admin approval routes call the **same transactional service**. On approval,
  it re-sanitizes `content_html`, normalizes `study_levels`, and sets
  `published_at`, `reviewed_at`, `reviewed_by`, `updated_at`.
  Only `pending` can be approved. Row is locked while the final content is prepared.
- Public list/detail responses do not return `original_content_html` or moderation
  fields; `content_html` is sanitized **again** on read to protect old already-published records.
- Web Admin must render `original_content_html` as code/text, not untrusted live HTML.
  Mobile WebView should still disable JavaScript unless specifically required.

## Crawler status (DB length constraint)
Database column `scholarship_crawl_logs.status` is VARCHAR(20); the string
`completed_with_errors` (21 chars) **cannot be persisted**.
Instead the DB stores `completed` with `failed_count > 0`, and the
`GET /api/admin/crawler/logs` endpoint derives `completed_with_errors`.
The in-memory `GET /api/admin/crawler/status` endpoint keeps using the existing
`completed_with_errors` status and the Web Admin receives the same effective label.

Crawler's `HEADLESS` environment variable now defaults to true for Linux/EC2;
set `HEADLESS=false` for local visual debugging.
Links from listing pages must use HTTP(S) and match the source's host
(with optional www prefix). HTTP redirects still warrant network policy controls.

## Manual regression tests
1. Run `npm ci` and `node --test tests/scholarshipContent.test.js` with a supported Node.js version.
2. Crawl YBOX master category; verify `study_levels = {'master'}`, not `{'Thạc sĩ'}`.
3. Confirm crawler article HTML is stored twice: raw original for admin and
   sanitized editable content; raw script tags never reach public APIs.
4. Edit pending `study_levels` with a Vietnamese label and an invalid date.
   Valid label maps to canonical; invalid date returns HTTP 400.
5. Use both admin approval URLs; confirm they set `published_at`, update status
   and only publish sanitized HTML.
6. Call both public scholarship endpoints and verify
   `original_content_html`, `rejection_reason` and `reviewed_by` are absent.
7. Simulate one failed crawled item: DB log row remains `completed` and the API
   displays `completed_with_errors` using `failed_count > 0`.
8. Verify previously published rows get canonical study levels after optional SQL
   migration and begin matching the Mobile `study_level` filter.
9. Smoke-test the existing CoreUI Web Admin pending list, edit form and approval.

## Limitations
- Unit/mock tests and static JS syntax checks do not replace real PostgreSQL,
  Puppeteer, Cheerio or Android WebView integration tests.
- Legacy `original_content_html` remains intentionally unsanitized and must
  never be served directly to untrusted clients.
- Deploy Crawler with outbound network restrictions to mitigate redirect-based SSRF.
