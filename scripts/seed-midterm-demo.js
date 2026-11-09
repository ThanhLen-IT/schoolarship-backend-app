// OPTIONAL STAGING-ONLY dataset for the midterm demo.
// Usage: DB_NAME=career_guidance_demo DEMO_PASSWORD='unique-strong-password' node scripts/seed-midterm-demo.js
// This script explicitly refuses production or a non-demo database name.
require('dotenv').config();
const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function insertAccount(client, email, name, username, passwordHash, role = 'user') {
  const result = await client.query(
    'INSERT INTO users (email, full_name, username, password_hash, role, is_mentor, is_active) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id',
    [email, name, username, passwordHash, role, role === 'mentor']
  );
  return result.rows[0].id;
}

async function insertApplication(client, data) {
  const {
    menteeId, mentorId, scholarshipId, completed, result, adminId
  } = data;
  const status = completed ? 'completed' : 'in_progress';
  const verified = result !== null;
  const inserted = await client.query(
    'INSERT INTO mentee_applications ' +
    '(mentee_id, mentor_id, scholarship_id, cv_file_url, introduction, status, ' +
    'mentoring_started_at, mentoring_completed_at, scholarship_outcome, ' +
    'outcome_verified_at, outcome_verified_by, outcome_note) ' +
    "VALUES ($1, $2, $3, 'https://example.org/demo/cv.pdf', 'Dữ liệu thử nghiệm giữa kỳ', $4, " +
    "NOW() - INTERVAL '7 days', " +
    "CASE WHEN $5::boolean THEN NOW() - INTERVAL '1 day' ELSE NULL END, " +
    "$6, CASE WHEN $7::boolean THEN NOW() ELSE NULL END, $8, " +
    "CASE WHEN $7::boolean THEN 'DEMO ONLY' ELSE NULL END) RETURNING id",
    [menteeId, mentorId, scholarshipId, status, completed, result || 'pending',
     verified, verified ? adminId : null]
  );
  return inserted.rows[0].id;
}

async function main() {
  const dbName = process.env.DB_NAME || '';
  const password = process.env.DEMO_PASSWORD || '';
  if (process.env.NODE_ENV === 'production' || !/_demo$|_test$/.test(dbName) ||
      password.length < 12) {
    throw new Error(
      'Chỉ được seed vào DB_NAME kết thúc _demo/_test, NODE_ENV != production ' +
      'và DEMO_PASSWORD >= 12 ký tự.'
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceUrl = 'https://example.org/scholarship-midterm-demo-2026';
    const exists = await client.query(
      'SELECT id FROM scholarships WHERE source_url = $1', [sourceUrl]
    );
    if (exists.rows.length) {
      throw new Error('Bộ dữ liệu midterm demo đã tồn tại. Không seed trùng.');
    }

    const hash = await bcrypt.hash(password, 12);
    const scholarship = await client.query(
      'INSERT INTO scholarships ' +
      '(title, organization, country, continent, type, study_levels, deadline, status, source_url) ' +
      "VALUES ('DEMO ONLY - Midterm Scholarship 2026', 'Demo University', " +
      "'Japan', 'Asia', 'full', ARRAY['master']::text[], '2027-03-31', 'published', $1) " +
      'RETURNING id',
      [sourceUrl]
    );
    const scholarshipId = scholarship.rows[0].id;
    const adminId = await insertAccount(client, 'midterm.admin@demo.invalid',
      'DEMO Admin', 'midterm_admin', hash, 'admin');
    const mentorA = await insertAccount(client, 'midterm.mentor.a@demo.invalid',
      'DEMO Mentor A', 'midterm_mentor_a', hash, 'mentor');
    const mentorB = await insertAccount(client, 'midterm.mentor.b@demo.invalid',
      'DEMO Mentor B', 'midterm_mentor_b', hash, 'mentor');
    for (const mentorId of [mentorA, mentorB]) {
      await client.query(
        'INSERT INTO mentor_verifications ' +
        '(user_id, evidence_file_url, scholarship_id, status, admin_note) ' +
        "VALUES ($1, '/demo/evidence-not-real.pdf', $2, 'approved', 'DEMO ONLY')",
        [mentorId, scholarshipId]
      );
    }

    const menteeIds = [];
    for (let i = 1; i <= 50; i++) {
      const padded = String(i).padStart(2, '0');
      const id = await insertAccount(
        client, 'midterm.student.' + padded + '@demo.invalid',
        'DEMO Student ' + padded, 'midterm_student_' + padded, hash
      );
      menteeIds.push(id);
    }

    let appsA = [];
    for (let i = 0; i < 50; i++) {
      const completed = i < 48;  // 48/50 = 96%
      const outcome = i < 25 ? (i < 23 ? 'awarded' : 'not_awarded') : null; // 23/25 = 92%
      const id = await insertApplication(client, {
        menteeId: menteeIds[i], mentorId: mentorA, scholarshipId,
        completed, result: outcome, adminId
      });
      appsA.push(id);
      if (i < 10) { // 9 x 5 + 1 x 4 => 4.9/5 = 98%
        await client.query(
          'INSERT INTO mentor_reviews (mentor_id, mentee_id, application_id, rating, comment) ' +
          "VALUES ($1, $2, $3, $4, 'DEMO ONLY')",
          [mentorA, menteeIds[i], id, i === 0 ? 4 : 5]
        );
      }
      // 50 explicitly requested help actions, 49 replies => 98%.
      await client.query(
        'INSERT INTO mentoring_response_requests ' +
        '(application_id, requested_by, request_note, requested_at, ' +
        'responded_by, response_note, responded_at) ' +
        "VALUES ($1, $2, 'DEMO help request', NOW() - INTERVAL '2 days', " +
        "$3, $4, CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() - INTERVAL '1 day' END)",
        [id, menteeIds[i], i < 49 ? mentorA : null,
         i < 49 ? 'DEMO mentor response' : null]
      );
    }

    for (let i = 0; i < 20; i++) {
      const completed = i < 18; // 18/20 = 90%
      const outcome = i < 10 ? (i < 8 ? 'awarded' : 'not_awarded') : null; // 8/10 = 80%
      const id = await insertApplication(client, {
        menteeId: menteeIds[i], mentorId: mentorB, scholarshipId,
        completed, result: outcome, adminId
      });
      if (i < 5) { // 4x5 + 1x4 => 4.8/5 = 96%
        await client.query(
          'INSERT INTO mentor_reviews (mentor_id, mentee_id, application_id, rating, comment) ' +
          "VALUES ($1, $2, $3, $4, 'DEMO ONLY')",
          [mentorB, menteeIds[i], id, i === 0 ? 4 : 5]
        );
      }
      if (i < 10) { // 6/10 = 60%
        await client.query(
          'INSERT INTO mentoring_response_requests ' +
          '(application_id, requested_by, request_note, requested_at, responded_by, response_note, responded_at) ' +
          "VALUES ($1, $2, 'DEMO help request', NOW() - INTERVAL '2 days', " +
          "$3, $4, CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() - INTERVAL '1 day' END)",
          [id, menteeIds[i], i < 6 ? mentorB : null,
           i < 6 ? 'DEMO mentor response' : null]
        );
      }
    }
    await client.query('COMMIT');
    console.log('DEMO ONLY - seed completed in ' + dbName);
    console.log('Scholarship ID: ' + scholarshipId);
    console.log('Ranking: GET /api/mentors/ranking?scholarship_id=' + scholarshipId);
    console.log('Mentor A expected 96.00, Mentor B expected 81.50 (both established).');
    console.log('Demo logins: midterm.admin@demo.invalid / midterm.mentor.a@demo.invalid');
    console.log('Passwords are from DEMO_PASSWORD (not printed). Never use a demo DB in production.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch(error => { console.error('DEMO seed failed:', error.message); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
