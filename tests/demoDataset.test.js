const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { seedDemo, validateTarget, demoPdf } = require('../scripts/seed-demo');

test('dataset command refuses the real database, production and weak passwords', () => {
  const valid = { DB_NAME: 'scholarship_demo', NODE_ENV: 'development', DEMO_PASSWORD: 'FixturePassword123' };
  validateTarget(valid);
  assert.throws(() => validateTarget({ ...valid, DB_NAME: 'scholarship_db' }));
  assert.throws(() => validateTarget({ ...valid, NODE_ENV: 'production' }));
  assert.throws(() => validateTarget({ ...valid, DEMO_PASSWORD: 'short' }));
  assert.throws(() => validateTarget({ ...valid, DEMO_PASSWORD: 'x'.repeat(73) }));
  assert.equal(demoPdf().subarray(0, 5).toString(), '%PDF-');
});

test('demo dataset uses the supplied schema, rolls back cleanly and supports real admin/mobile APIs', { timeout: 60000 }, async t => {
  const db = new PGlite();
  const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-demo-'));
  t.after(async () => { await db.close(); await fs.rm(uploads, { recursive: true, force: true }); });
  await db.exec(await fs.readFile(path.join(__dirname, 'fixtures/database-v1-schema.sql'), 'utf8'));
  await db.exec('SET search_path TO public');
  for (const migration of ['20261110_midterm_mentor_ranking.sql', '20261110_normalize_scholarship_study_levels.sql', '20261111_mobile_completion.sql', '20261111_crawler_status_width.sql'])
    await db.exec(await fs.readFile(path.join(__dirname, '../migrations', migration), 'utf8'));
  const options = { password: 'FixturePassword123', baseDate: '2026-11-11', uploadDir: uploads };
  const dry = await seedDemo(db, options);
  assert.equal(dry.applied, false);
  assert.equal(dry.created.scholarships, 60);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0);
  assert.deepEqual(await fs.readdir(uploads), []);
  await assert.rejects(seedDemo({ query(sql, params) {
    if (sql.startsWith('INSERT INTO transactions')) throw new Error('injected failure');
    return db.query(sql, params);
  } }, { ...options, apply: true }), /injected failure/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0);
  assert.deepEqual(await fs.readdir(uploads), []);

  // Existing unrelated records must survive the seed unchanged.
  const existing = (await db.query("INSERT INTO users(email,password_hash,full_name) VALUES('existing@example.test','untouched-hash','Existing account') RETURNING id")).rows[0];
  const result = await seedDemo(db, { ...options, apply: true });
  assert.equal(result.created.users, 48);
  assert.equal(result.created.scholarships, 60);
  assert.equal(result.created.mentee_applications, 48);
  assert.equal(result.created.app_events, 249);
  assert.equal(result.created.notifications, 54);
  assert.equal((await fs.readdir(uploads)).length, 16);
  await db.exec(await fs.readFile(path.join(__dirname, '../migrations/20261111_crawler_status_width.sql'), 'utf8'));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM scholarship_crawl_logs WHERE status='completed_with_errors'")).rows[0].n, 3);
  assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1', [existing.id])).rows[0].password_hash, 'untouched-hash');
  assert.equal((await seedDemo(db, { ...options, apply: true })).alreadySeeded, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM scholarships')).rows[0].n, 60);
  assert.equal((await fs.readdir(uploads)).length, 16);
  const malformed = await db.query(`SELECT id FROM mentee_applications WHERE
    mentoring_completed_at < mentoring_started_at OR
    (scholarship_outcome <> 'pending' AND outcome_verified_by IS NULL)`);
  assert.equal(malformed.rows.length, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM app_events WHERE user_id IS NULL')).rows[0].n, 0);

  const pool = { query: (sql, args) => db.query(sql, args), connect: async () => ({ query: (sql, args) => db.query(sql, args), release() {} }) };
  const key = require.resolve('../src/config/db');
  require.cache[key] = { id: key, filename: key, loaded: true, exports: pool };
  const prior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'dataset-test-secret';
  t.after(() => { if (prior === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prior; });
  const app = express(); app.use(express.json());
  const uploadModule = require('../src/middlewares/uploadMiddleware');
  const oldUploadDir = uploadModule.uploadDir;
  uploadModule.uploadDir = uploads;
  t.after(() => { uploadModule.uploadDir = oldUploadDir; });
  app.use('/api/auth', require('../src/routes/authRoutes'));
  app.use('/api/admin/scholarships', require('../src/routes/adminScholarshipRoutes'));
  app.use('/api/scholarships', require('../src/routes/scholarshipRoutes'));
  app.use('/api/mentors', require('../src/routes/mentorRoutes'));
  app.use('/api/mentoring', require('../src/routes/mentoringRoutes'));
  app.use('/api', require('../src/routes/mobileRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const users = (await db.query('SELECT * FROM users WHERE email LIKE $1', ['%@global-success.demo.invalid'])).rows;
  const admin = users.find(u => u.role === 'admin');
  const student = users.find(u => u.email.startsWith('student01@'));
  assert.ok(await bcrypt.compare(options.password, student.password_hash));
  const token = user => jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  async function api(route, user = admin, method = 'GET') {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, { method, headers: { Authorization: 'Bearer ' + token(user) } });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await api('/api/admin/scholarships?limit=10', student)).status, 403);
  assert.equal((await api('/api/auth/me', users.find(u => !u.is_active))).status, 403);
  const pending = await api('/api/admin/scholarships?status=pending&limit=10');
  assert.equal(pending.status, 200);
  assert.equal(pending.body.data.length, 10);
  assert.equal((await api('/api/scholarships/' + pending.body.data[0].id, student)).status, 404);
  const filters = await api('/api/scholarships/filters');
  assert.equal(filters.status, 200);
  assert.equal(filters.body.data.countries.length, 10);
  const ranking = await api('/api/mentors/ranking?scholarship_id=' + result.scholarshipId);
  assert.equal(ranking.status, 200);
  assert.equal(ranking.body.data.length, 3);
  assert.ok(ranking.body.data.every(row => row.ranking_status === 'established'));
  assert.deepEqual(ranking.body.data.map(row => row.ranking_score), [86.83, 81.33, 75.83]);
  assert.equal((await api('/api/admin/support/tickets')).status, 200);
  assert.equal((await api('/api/chat/conversations', student)).body.data.length, 1);
  const cvApplication = (await db.query('SELECT id FROM mentee_applications WHERE mentee_id=$1 ORDER BY id LIMIT 1', [student.id])).rows[0];
  const cvUrl = 'http://127.0.0.1:' + server.address().port + '/api/mentoring/applications/' + cvApplication.id + '/cv';
  const cv = await fetch(cvUrl, { headers: { Authorization: 'Bearer ' + token(student) } });
  assert.equal(cv.status, 200);
  assert.ok((await cv.text()).includes('GLOBAL SUCCESS - DEMO CV'));
  const denied = await fetch(cvUrl, { headers: { Authorization: 'Bearer ' + token(users.find(u => u.email.startsWith('student40@'))) } });
  assert.equal(denied.status, 404);
  const approve = await api('/api/admin/scholarships/' + pending.body.data[0].id + '/approve', admin, 'PATCH');
  assert.equal(approve.status, 200);
});
