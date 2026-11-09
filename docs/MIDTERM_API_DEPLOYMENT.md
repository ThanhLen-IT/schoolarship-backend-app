# Midterm MVP: Auth, Profile, Scholarship Search & Ranking

This PR implements the backend for the four required midterm modules. It does NOT deploy EC2, execute SQL migrations, or update the Android client.

## Database migration (required)

Database-v1.0 is the baseline. Back up the live database before making schema changes.
Use a restored staging DB first, then run the additive SQL in:

    migrations/20261110_midterm_mentor_ranking.sql

For example, in Ubuntu/Linux:

    pg_dump -Fc -h YOUR_DB_HOST -U YOUR_DB_USER -d YOUR_DB_NAME -f backup-before-midterm.dump
    psql -h YOUR_DB_HOST -U YOUR_DB_USER -d YOUR_TEST_DB_NAME -v ON_ERROR_STOP=1 -f migrations/20261110_midterm_mentor_ranking.sql

Or paste the migration into pgAdmin 4 > Query Tool. It does not alter existing rows,
remove columns, or insert simulated data. It creates mentor_response_requests and
adds mentoring/outcome fields to mentee_applications.

Without the migration, the Ranking/progress API will not work.
GET /health/ready tests PostgreSQL connectivity, not whether migrations are applied.

## Scholarship search API

GET /api/scholarships?country=Japan&type=full&study_level=master&deadline_from=2026-11-10&deadline_to=2027-03-31

- Filters can be combined or omitted.
- Deadline range is inclusive (YYYY-MM-DD); invalid days and reversed ranges -> HTTP 400.
- Only published scholarships appear.
- Sorting, paging and other existing query parameters are unchanged.

## Mentor Ranking API

GET /api/mentors/ranking?scholarship_id=123&page=1&limit=20

- Public read; scholarship must be published.
- Only approved and active Mentors verified for that SAME scholarship.
- Latest application per (mentor, mentee, scholarship) is the ranking cohort.

Measures:
- Mentee Success Rate = awarded outcomes / (awarded + not_awarded) outcomes confirmed by Admin * 100.
- Average Rating Score = mean rating for this scholarship / 5 * 100.
- Mentoring Completion Rate = completed mentees / started mentees * 100.
- Response Rate = responded explicit help requests / all explicit help requests * 100.

Equal provisional weights are 25% each: score = (S + R + C + P)/4.
Your supplied example (92,98,96,98) gives score 96/100.
Official instructor weights have not been provided.

If any denominator is zero, the corresponding metric and ranking_score are null.
A Mentor without four measured metrics has NO rank, not artificial 0% or 100%.
A sample size threshold of 5 per criterion distinguishes:
established, provisional (small sample), and insufficient_data.
Established Mentors sort before provisional entries to avoid a few perfect ratings
automatically outranking large-sample Mentors. Response includes all sample counts.

## Secure data collection workflow

All endpoints here except public ranking/search require Authorization: Bearer JWT.

Mentee creates an application:

    POST /api/mentoring/applications
    {"mentor_id":7,"scholarship_id":123,"cv_file_url":"https://private-host.example/cv.pdf","introduction":"Need SOP help"}

The scholarship and Mentor must be published/approved. Duplicate active
applications are blocked. In production, CV URLs must be private and access-controlled.

Both mentee and Mentor can see applications they participate in:

    GET /api/mentoring/applications/mine

Progress events:

    PATCH /api/mentoring/applications/456/progress
    {"action":"accept"}     Mentor: pending -> accepted
    {"action":"start"}      Mentor: accepted -> in_progress
    {"action":"complete"}   Mentee: in_progress -> completed
    {"action":"reject"}     Mentor: pending -> rejected

A mentee in an in_progress application explicitly requests a reply:

    POST /api/mentoring/applications/456/response-requests
    {"request_note":"Please review my SOP."}

Limit 10 requests per application per hour.
The two participants may list them:

    GET /api/mentoring/applications/456/response-requests

An approved Mentor replies once:

    PATCH /api/mentoring/response-requests/789/respond
    {"response_note":"Please rewrite paragraph 2."}

Response Rate counts ONLY those explicit support requests, not every chat message.

After completion the mentee gives a review via the existing BE-07 endpoint:

    POST /api/mentors/7/reviews
    {"application_id":456,"rating":5,"comment":"Useful support"}

Admin verifies the real scholarship outcome:

    PATCH /api/admin/mentoring/applications/456/outcome
    {"outcome":"awarded","note":"Verified against award letter"}

The other allowed outcome is not_awarded. Results can be verified only once
after the mentee has confirmed completion. Audit fields include the Admin ID and
verification timestamp. Verification should be backed by authentic evidence.

## Optional TEST-ONLY dataset

After the migration, create a separate copied database named career_guidance_demo
(or a name ending in _test). The seed script refuses production environments or
normal database names. It does not run during merge, install or API startup.

Linux shell example:

    export DB_NAME=career_guidance_demo
    export NODE_ENV=development
    export DEMO_PASSWORD='a-unique-strong-test-password'
    node scripts/seed-midterm-demo.js

On Windows PowerShell set variables with the $env:VARIABLE syntax.

This inserts clear DEMO ONLY users, an Admin, one published scholarship,
two approved Mentors, 50 demo mentees, verifications, applications, reviews and
explicit response requests. Expected results:
- Mentor A: S=92, R=98, C=96, P=98 -> 96.00
- Mentor B: S=80, R=96, C=90, P=60 -> 81.50

Use these records only in a separate staging/demo database, never production.
Demo passwords are supplied from the environment and not stored in GitHub.

## Automated and manual tests

    npm ci
    npm test
    node --check src/app.js

Manual end-to-end checks are also essential:
1. Register, log in, fetch /api/auth/me and update /api/users/profile on Android.
2. Filter scholarships by country, type, level and deadline together.
3. Create an application; Mentor accepts/starts; mentee requests response,
   Mentor replies; mentee completes; mentee reviews; Admin verifies outcome.
4. Check Ranking for the correct scholarship, counts, score, status and rank.
5. Try a nonexistent scholarship, a non-mentor progressing someone else's
   application, and an invalid date. Expect safe error codes.
6. Confirm GET /health = 200 and GET /health/ready = 200 when DB is reachable.

## EC2 / Android preparation checklist (not executed by this PR)

1. Use Ubuntu EC2 with Node.js 22 LTS and enough resources.
2. Store PostgreSQL on RDS or persistent EBS with automated backups.
3. Configure a private .env: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
   JWT_SECRET, JWT_EXPIRES_IN and PORT=5000. Never push .env to GitHub.
4. Optional for midterm without Crawler: PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev.
   Crawler does require Chrome/Chromium when enabled.
5. Apply SQL migration on staging, run app under PM2/systemd and verify /health/ready.
6. Put Nginx and HTTPS in front of Node; only open ports 80/443 and limited SSH
   publicly. Do not expose 5432 or 5000 to the Internet.
7. Configure Android's API base URL to point to your HTTPS EC2 domain.
   A physical device cannot use localhost / 10.0.2.2 as a public EC2 address.
8. Keep Mentor upload evidence on private persistent storage (not public HTTP).
9. Never connect the demo seed or demo accounts to the production DB.

This PR does not assert that the Android app has been built or EC2 provisioned.
Real device tests and remote deployment require access to that environment.
