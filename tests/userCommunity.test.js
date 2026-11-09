const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

// Load controllers with mocked dependencies; tests never touch the real database.
function load(relativePath, mocks = {}) {
  const filename = join(__dirname, '..', relativePath);
  const moduleObject = { exports: {} };
  const context = {
    module: moduleObject,
    exports: moduleObject.exports,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      throw new Error('Missing mock: ' + name);
    },
    console: { error() {} },
    process: { env: { JWT_SECRET: 'unit-test-only', JWT_EXPIRES_IN: '7d' } },
    Buffer,
    URL
  };
  vm.runInNewContext(readFileSync(filename, 'utf8'), context, { filename });
  return moduleObject.exports;
}

function makeResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
}

test('username accepts @ prefix and matches DB format', () => {
  const validation = load('src/utils/userProfileValidation.js');
  assert.equal(validation.normalizeUsername('@KimLoan12'), 'kimloan12');
  assert.throws(() => validation.normalizeUsername('@ab'));
  assert.throws(() => validation.normalizeUsername('bad-handle'));
  assert.throws(() => validation.validateProfileInput({ role: 'admin' }));
  const profile = validation.validateProfileInput({ major: 'Networks', skills: ['JS', 'JS'] });
  assert.equal(JSON.stringify(profile.skills), JSON.stringify(['JS']));
});

test('registration stores normalized username and blocks short passwords', async () => {
  const validation = load('src/utils/userProfileValidation.js');
  const calls = [];
  const auth = load('src/controllers/authController.js', {
    '../config/db': {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ id: 17, email: values[0], username: values[5], role: 'user', is_mentor: false }] };
      }
    },
    '../utils/userProfileValidation': validation,
    '../services/passwordResetEmailService': {
      isPasswordResetEmailConfigured: () => false,
      sendPasswordResetEmail: async () => {}
    },
    bcryptjs: { hash: async () => 'hash', compare: async () => true },
    jsonwebtoken: { sign: () => 'jwt' },
    crypto: {},
    dotenv: { config() {} }
  });
  const ok = makeResponse();
  await auth.register({
    body: { email: 'STUDENT@example.com', password: 'CorrectHorse123', full_name: 'Student',
      username: '@KimLoan12', major: 'Networks' }
  }, ok);
  assert.equal(ok.statusCode, 201);
  assert.equal(calls[0].values[0], 'student@example.com');
  assert.equal(calls[0].values[5], 'kimloan12');

  const bad = makeResponse();
  await auth.register({
    body: { email: 'student@example.com', password: 'weak', full_name: 'Student' }
  }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(calls.length, 1);
});

test('username login still supports the original email login', async () => {
  const validation = load('src/utils/userProfileValidation.js');
  const calls = [];
  const auth = load('src/controllers/authController.js', {
    '../config/db': {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ id: 17, email: 'student@example.com', username: 'kimloan12',
          role: 'user', is_mentor: false, is_active: true, password_hash: 'hashed' }] };
      }
    },
    '../utils/userProfileValidation': validation,
    '../services/passwordResetEmailService': {
      isPasswordResetEmailConfigured: () => false,
      sendPasswordResetEmail: async () => {}
    },
    bcryptjs: { hash: async () => 'hash', compare: async () => true },
    jsonwebtoken: { sign: () => 'jwt' },
    crypto: {},
    dotenv: { config() {} }
  });
  const byUsername = makeResponse();
  await auth.login({ body: { username: '@KimLoan12', password: 'CorrectHorse123' } }, byUsername);
  assert.equal(byUsername.statusCode, 200);
  assert.equal(calls[0].values[1], 'kimloan12');
  const byEmail = makeResponse();
  await auth.login({ body: { email: 'STUDENT@example.com', password: 'CorrectHorse123' } }, byEmail);
  assert.equal(byEmail.statusCode, 200);
});

test('profile endpoint rejects attempts to modify roles', async () => {
  const validation = load('src/utils/userProfileValidation.js');
  let touchedDB = false;
  const users = load('src/controllers/userController.js', {
    '../config/db': { async query() { touchedDB = true; return { rows: [] }; } },
    '../utils/userProfileValidation': validation,
    '../utils/publicScholarship': { toPublicScholarship: x => x }
  });
  const result = makeResponse();
  await users.updateProfile({ user: { id: 17 }, body: { is_mentor: true } }, result);
  assert.equal(result.statusCode, 400);
  assert.equal(touchedDB, false);
});

test('bookmark response hides raw scholarship content', async () => {
  const validation = load('src/utils/userProfileValidation.js');
  const users = load('src/controllers/userController.js', {
    '../config/db': {
      async query() {
        return { rows: [{ id: 2, original_content_html: '<script>bad</script>',
          content_html: '<p>Safe</p>' }] };
      }
    },
    '../utils/userProfileValidation': validation,
    '../utils/publicScholarship': {
      toPublicScholarship: row => ({ id: row.id, content_html: row.content_html })
    }
  });
  const result = makeResponse();
  await users.getSavedScholarships({ user: { id: 17 } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data[0].original_content_html, undefined);
});

test('post pagination returns actual count and hides unpublished scholarship posts', async () => {
  const calls = [];
  const posts = load('src/controllers/postController.js', {
    '../config/db': {
      async query(sql, values) {
        calls.push({ sql, values });
        return sql.includes('COUNT(*)') ? { rows: [{ total: 42 }] } : { rows: [{ id: 1 }] };
      }
    }
  });
  const result = makeResponse();
  await posts.getPosts({ query: { page: '2', limit: '15' } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, 42);
  assert.equal(result.body.page, 2);
  assert.match(calls[0].sql, /s.status = 'published'/);
  assert.deepEqual(JSON.stringify(calls[1].values), JSON.stringify([15, 15]));
});

test('like is transactional and recounts likes from DB', async () => {
  const queries = [];
  const client = {
    release() {},
    async query(sql) {
      queries.push(sql);
      if (sql.includes('SELECT p.id')) return { rows: [{ id: 2 }] };
      if (sql.includes('DELETE FROM post_likes')) return { rows: [] };
      if (sql.includes('UPDATE posts')) return { rows: [{ like_count: 1 }] };
      return { rows: [] };
    }
  };
  const posts = load('src/controllers/postController.js', {
    '../config/db': { connect: async () => client }
  });
  const result = makeResponse();
  await posts.toggleLikePost({ user: { id: 17 }, params: { id: '2' } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.is_liked, true);
  assert.ok(queries.some(sql => sql.includes('FOR UPDATE OF p')));
  assert.ok(queries.some(sql => sql.includes('COUNT(*)::int FROM post_likes')));
  assert.ok(queries.includes('COMMIT'));
});

test('comments cannot reference a parent from another post', async () => {
  const queries = [];
  const client = {
    release() {},
    async query(sql) {
      queries.push(sql);
      if (sql.includes('SELECT p.id')) return { rows: [{ id: 2 }] };
      if (sql.includes('SELECT id FROM comments')) return { rows: [] };
      return { rows: [] };
    }
  };
  const posts = load('src/controllers/postController.js', {
    '../config/db': { connect: async () => client }
  });
  const result = makeResponse();
  await posts.addComment({
    user: { id: 17 }, params: { id: '2' },
    body: { content: 'Reply', parent_id: 900 }
  }, result);
  assert.equal(result.statusCode, 400);
  assert.ok(!queries.some(sql => sql.startsWith('INSERT INTO comments')));
});
