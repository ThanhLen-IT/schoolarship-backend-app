const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { rankMentors } = require('../src/utils/mentorRanking');

function loadController(relativePath, dependencies) {
  const filename = path.join(__dirname, '..', relativePath);
  const mod = { exports: {} };
  const sandbox = {
    require(name) {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
      throw new Error('Missing test mock: ' + name);
    },
    module: mod, exports: mod.exports,
    console: { error() {} },
    process: { env: { JWT_SECRET: 'unit-test-secret' } },
    URL, Buffer
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return mod.exports;
}
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

test('deadline_from and deadline_to use parameterized inclusive SQL', async () => {
  const calls = [];
  const controller = loadController('src/controllers/scholarshipController.js', {
    '../config/db': {
      async query(query, params) {
        calls.push({ query, params });
        return query.includes('COUNT(*)')
          ? { rows: [{ total: '1' }] } : { rows: [{ id: 1, status: 'published' }] };
      }
    },
    '../utils/publicScholarship': { toPublicScholarship: row => row },
    '../utils/scholarshipContent': {
      normalizeStudyLevels: val => val, sanitizeScholarshipHtml: x => x
    },
    '../services/scholarshipApprovalService': {}
  });
  const res = response();
  await controller.getScholarships({
    query: { country: 'Japan', type: 'full', study_level: 'master',
      deadline_from: '2026-11-10', deadline_to: '2026-12-31' }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.match(calls[0].query, /deadline >= \$\d+/);
  assert.match(calls[0].query, /deadline <= \$\d+/);
  assert.ok(calls[0].params.includes('2026-11-10'));
  assert.ok(calls[0].params.includes('2026-12-31'));
  assert.ok(calls[0].params.includes('master'));
  assert.ok(calls[0].params.includes('Japan'));
});

test('invalid/reversed deadline range rejected with 400 before SQL', async () => {
  let count = 0;
  const controller = loadController('src/controllers/scholarshipController.js', {
    '../config/db': { async query() { count++; return { rows: [] }; } },
    '../utils/publicScholarship': { toPublicScholarship: row => row },
    '../utils/scholarshipContent': {
      normalizeStudyLevels: val => val, sanitizeScholarshipHtml: x => x
    },
    '../services/scholarshipApprovalService': {}
  });
  for (const query of [
    { deadline_from: '2026-02-30' },
    { deadline_from: '2026-12-10', deadline_to: '2026-11-10' }
  ]) {
    const res = response();
    await controller.getScholarships({ query }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(count, 0);
});

test('ranking API is limited to an actual published scholarship', async () => {
  let queries = 0;
  const ctrl = loadController('src/controllers/mentorRankingController.js', {
    '../config/db': { async query() { queries++; return { rows: [] }; } },
    '../utils/mentorRanking': {
      WEIGHTS: { success: 0.25, rating: 0.25, completion: 0.25, response: 0.25 },
      MIN_SAMPLE_SIZE: 5, rankMentors
    }
  });
  const invalid = response();
  await ctrl.getRanking({ query: { scholarship_id: 'invalid' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(queries, 0);
  const missing = response();
  await ctrl.getRanking({ query: { scholarship_id: '123' } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(queries, 1);
});

test('ranking SQL aggregates within scholarship and only approved mentors', async () => {
  const calls = [];
  const ctrl = loadController('src/controllers/mentorRankingController.js', {
    '../config/db': {
      async query(query, params) {
        calls.push({ query, params });
        if (query.includes('FROM scholarships WHERE')) {
          return { rows: [{ id: 12, title: 'Scholarship 12' }] };
        }
        return { rows: [{
          mentor_id: 8, full_name: 'Mentor', username: 'mentor_8',
          decided_count: 25, awarded_count: 23, rating_count: 10,
          avg_rating: 4.9, started_count: 25, completed_count: 24,
          request_count: 50, responded_count: 49
        }] };
      }
    },
    '../utils/mentorRanking': {
      WEIGHTS: { success: 0.25, rating: 0.25, completion: 0.25, response: 0.25 },
      MIN_SAMPLE_SIZE: 5, rankMentors
    }
  });
  const res = response();
  await ctrl.getRanking({ query: { scholarship_id: '12' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].ranking_score, 96);
  assert.equal(res.body.data[0].rank, 1);
  assert.match(calls[1].query, /ma\.scholarship_id = \$1/);
  assert.match(calls[1].query, /mv\.scholarship_id = \$1/);
  assert.match(calls[1].query, /mr\.application_id = la\.id/);
  assert.match(calls[1].query, /rr\.application_id = la\.id/);
});

test('non-mentor cannot accept a mentoring application', async () => {
  let called = false;
  const ctrl = loadController('src/controllers/mentoringProgressController.js', {
    '../config/db': { async query() { called = true; return { rows: [] }; } }
  });
  const res = response();
  await ctrl.updateApplicationProgress({
    params: { id: '9' }, body: { action: 'accept' },
    user: { id: 2, role: 'user', is_mentor: false }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(called, false);
});

test('invalid mentoring outcomes are rejected', async () => {
  let called = false;
  const ctrl = loadController('src/controllers/mentoringProgressController.js', {
    '../config/db': { async query() { called = true; return { rows: [] }; } }
  });
  const res = response();
  await ctrl.recordOutcome({
    params: { id: '9' }, body: { outcome: 'awarded_fake' }, user: { id: 1 }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test('response request requires an explicit note, not arbitrary chat messages', async () => {
  let called = false;
  const ctrl = loadController('src/controllers/mentoringProgressController.js', {
    '../config/db': { async query() { called = true; return { rows: [] }; } }
  });
  const res = response();
  await ctrl.createResponseRequest({ params: { id: '9' }, body: {},
    user: { id: 2 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});


test('Mentor discovery filters approved verification and ratings by the selected scholarship', async () => {
  const calls = [];
  const controller = loadController('src/controllers/mentorController.js', {
    '../config/db': {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 1 }] };
        return { rows: [{ id: 7, full_name: 'Mentor' }] };
      }
    },
    'fs/promises': {}
  });
  const res = response();
  await controller.getMentors({ query: { scholarship_id: '123' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 1);
  assert.match(calls[0].sql, /mv\.scholarship_id = \$1/);
  assert.match(calls[1].sql, /ma\.scholarship_id = \$1/);
  assert.deepEqual(JSON.stringify(calls[0].params), JSON.stringify([123]));
});
