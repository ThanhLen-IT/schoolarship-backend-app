const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setImmediate: tick } = require('node:timers/promises');
const express = require('express');
const cors = require('cors');
const { createRequestLogger } = require('../src/middlewares/requestLogger');
const { errorHandler } = require('../src/middlewares/errorHandler');

// Real Express + HTTP lifecycle, with fixture handlers and no DB/email calls.
async function startApp(t, setup, options = {}) {
  const lines = [];
  const records = [];
  const app = express();
  app.use(createRequestLogger({
    write: options.write || (line => {
      lines.push(line);
      const record = JSON.parse(line);
      records.push(record);
      options.onRecord?.(record);
    })
  }));
  app.use(cors());
  app.use(express.json());
  setup(app);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, records, lines };
}

test('login logs server-confirmed actor, UUID and one JSON line; never logs credentials', async t => {
  const secret = 'private-login-password';
  const { url, records, lines } = await startApp(t, app => {
    app.post('/api/auth/login', (req, res) => res.json({
      success: true,
      data: { token: 'private-response-jwt', user: { id: 17, role: 'user',
        email: 'private-student@example.com', password_hash: 'private-password-hash' } }
    }));
  });
  const response = await fetch(url + '/api/auth/login?token=private-query-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      Authorization: 'Bearer private-header-jwt', 'X-Request-Id': 'untrusted-request-id',
      Cookie: 'session=private-cookie', 'User-Agent': 'private-agent' },
    body: JSON.stringify({ password: secret, email: 'private-student@example.com', user_id: 999 })
  });
  assert.equal((await response.json()).data.token, 'private-response-jwt');
  await tick();
  assert.equal(records.length, 1);
  const entry = records[0];
  assert.equal(entry.action, 'auth.login');
  assert.equal(entry.route, '/api/auth/login');
  assert.equal(entry.user_id, 17);
  assert.equal(entry.user_role, 'user');
  assert.equal(entry.outcome, 'success');
  assert.equal(entry.status, 200);
  assert.match(entry.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(entry.request_id, response.headers.get('x-request-id'));
  assert.equal(Number.isFinite(entry.duration_ms), true);
  assert.ok(entry.duration_ms >= 0);
  assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  assert.equal(lines[0].split('\n').length, 2);
  assert.doesNotMatch(lines[0], /private-|untrusted-request-id/);
});

test('registration attributes a successful 201 to the newly created server user', async t => {
  const { url, records } = await startApp(t, app => {
    app.post('/api/auth/register', (req, res) => res.status(201).json({
      success: true, data: { user: { id: 18, role: 'user' }, token: 'not-logged' }
    }));
  });
  const response = await fetch(url + '/api/auth/register', { method: 'POST' });
  await response.json();
  await tick();
  assert.equal(records[0].user_id, 18);
  assert.equal(records[0].action, 'auth.register');
  assert.equal(records[0].status, 201);
});

test('failed login cannot impersonate a user using body, query or response data', async t => {
  const { url, records, lines } = await startApp(t, app => {
    app.post('/api/auth/login', (req, res) => res.status(401).json({
      success: false, data: { user: { id: 999, role: 'admin' }, token: 'private-token' }
    }));
  });
  const response = await fetch(url + '/api/auth/login?user_id=999', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { id: 999, role: 'admin' }, password: 'private-password' })
  });
  await response.json();
  await tick();
  assert.equal(records[0].user_id, null);
  assert.equal(records[0].user_role, null);
  assert.equal(records[0].outcome, 'rejected');
  assert.equal(records[0].level, 'warn');
  assert.doesNotMatch(lines[0], /private-|admin/);
});

test('profile update uses authenticated req.user and omits edited personal details', async t => {
  const { url, records, lines } = await startApp(t, app => {
    app.put('/api/users/profile', (req, res) => {
      req.user = { id: 23, role: 'user', email: 'private-email@example.com' };
      res.json({ success: true, data: { id: 23, bio: 'private-biography' } });
    });
  });
  const response = await fetch(url + '/api/users/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 999, role: 'admin', bio: 'private-biography' })
  });
  await response.json();
  await tick();
  assert.equal(records[0].user_id, 23);
  assert.equal(records[0].action, 'user.profile.update');
  assert.doesNotMatch(lines[0], /private-|admin/);
});

test('auth rejection in router.use still logs the intended save action and numeric target', async t => {
  const { url, records } = await startApp(t, app => {
    const router = express.Router();
    router.use((req, res) => res.status(401).json({ success: false }));
    router.post('/saved/:scholarshipId', () => assert.fail('auth must reject first'));
    app.use('/api/users', router);
  });
  const response = await fetch(url + '/api/users/saved/73', { method: 'POST' });
  await response.json();
  await tick();
  assert.equal(records[0].route, '/api/users/saved/:scholarshipId');
  assert.equal(records[0].action, 'scholarship.save');
  assert.equal(records[0].target_id, 73);
  assert.equal(records[0].user_id, null);
  assert.equal(records[0].status, 401);
});

test('public search records filter names but no query values or unverified identity', async t => {
  const { url, records, lines } = await startApp(t, app => {
    app.get('/api/scholarships', (req, res) => res.json({ success: true, data: [] }));
  });
  const response = await fetch(url + '/api/scholarships?search=private-search&country=private-country&limit=20&token=private-token', {
    headers: { Authorization: 'Bearer private-jwt', 'X-User-Id': '999' }
  });
  await response.json();
  await tick();
  assert.equal(records[0].action, 'scholarship.search');
  assert.equal(records[0].user_id, null);
  assert.deepEqual(records[0].filter_keys, ['search', 'country', 'limit']);
  assert.doesNotMatch(lines[0], /private-/);
});

test('like and unlike reflect server results and finish/close do not double-log', async t => {
  let liked = true;
  const { url, records } = await startApp(t, app => {
    app.post('/api/posts/:id/like', (req, res) => {
      req.user = { id: 23, role: 'user' };
      res.json({ success: true, is_liked: liked });
    });
  });
  const first = await fetch(url + '/api/posts/82/like', { method: 'POST' });
  await first.json();
  liked = false;
  const second = await fetch(url + '/api/posts/82/like', { method: 'POST' });
  await second.json();
  await tick();
  assert.equal(records.length, 2);
  assert.equal(records[0].action, 'community.post.like');
  assert.equal(records[1].action, 'community.post.unlike');
  assert.equal(records[1].target_id, 82);
  assert.notEqual(records[0].request_id, records[1].request_id);
});

test('HTTP 200 with success:false is not a successful activity', async t => {
  const { url, records } = await startApp(t, app => {
    app.put('/api/users/profile', (req, res) => res.json({ success: false }));
  });
  const response = await fetch(url + '/api/users/profile', { method: 'PUT' });
  await response.json();
  await tick();
  assert.equal(records[0].status, 200);
  assert.equal(records[0].outcome, 'rejected');
});

test('malformed JSON logs 400 without raw parser error, request body or password', async t => {
  const { url, records, lines } = await startApp(t, app => {
    app.post('/api/auth/login', () => assert.fail('malformed body must not reach route'));
  });
  const response = await fetch(url + '/api/auth/login?token=private-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{"password":"private-password","email":'
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
  await tick();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 400);
  assert.equal(records[0].error_type, 'SyntaxError');
  assert.equal(records[0].outcome, 'rejected');
  assert.doesNotMatch(lines[0], /private-|Unexpected|stack|password|email/);
});

test('unexpected server errors retain a safe category and code, not stack/message data', async t => {
  const { url, records, lines } = await startApp(t, app => {
    app.get('/health/ready', () => {
      const error = new Error('private-database-password');
      error.code = 'ECONNREFUSED';
      throw error;
    });
  });
  const response = await fetch(url + '/health/ready');
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private-/);
  await tick();
  assert.equal(records[0].level, 'error');
  assert.equal(records[0].error_code, 'ECONNREFUSED');
  assert.equal(records[0].outcome, 'error');
  assert.doesNotMatch(lines[0], /private-|stack|message/);
});

test('unknown URLs and invalid resource IDs are never echoed into the log', async t => {
  const { url, records, lines } = await startApp(t, app => {
    app.get('/api/scholarships/:id', (req, res) => res.status(400).json({ success: false }));
  });
  for (const path of ['/private-reset/private-secret?token=private-query', '/api/scholarships/private-secret']) {
    const response = await fetch(url + path);
    await response.text();
  }
  await tick();
  assert.equal(records[0].route, '[unmatched]');
  assert.equal(records[0].status, 404);
  assert.equal(records[1].route, '/api/scholarships/:id');
  assert.equal(records[1].target_id, undefined);
  assert.doesNotMatch(lines.join(''), /private-/);
});

test('CORS preflight is logged even though CORS finishes before the router', async t => {
  const { url, records } = await startApp(t, () => {});
  const response = await fetch(url + '/api/users/profile', {
    method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'PUT' }
  });
  await response.text();
  await tick();
  assert.equal(response.status, 204);
  assert.equal(records[0].action, 'http.preflight');
  assert.equal(records[0].route, '/api/users/profile');
});

test('client disconnect logs aborted once instead of a false 200 success', { timeout: 5000 }, async t => {
  let complete;
  const completed = new Promise(resolve => { complete = resolve; });
  const { url, records } = await startApp(t, app => {
    app.get('/api/scholarships/:id', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial response'); // Deliberately no end(), to exercise close.
    });
  }, { onRecord: complete });
  const request = http.get(url + '/api/scholarships/73', response => {
    response.once('data', () => response.destroy());
  });
  request.on('error', () => {});
  await completed;
  await tick();
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, 'aborted');
  assert.equal(records[0].status, null);
});

test('a throwing log sink cannot break the response', async t => {
  const { url } = await startApp(t, app => {
    app.get('/health', (req, res) => res.json({ success: true }));
  }, { write() { throw new Error('sink unavailable'); } });
  const response = await fetch(url + '/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
});

test('an accepted reset request still flags email delivery failure without leaking Axios config', async t => {
  const { url, records, lines } = await startApp(t, app => {
    app.post('/api/auth/forgot-password', (req, res) => {
      const error = new Error('private-reset-token in request body');
      error.name = 'AxiosError';
      error.code = 'ERR_BAD_REQUEST';
      error.config = { headers: { Authorization: 'Bearer private-api-key' }, data: 'private-email-content' };
      error.response = { status: 403, data: { message: 'private-reset-url' } };
      req.logError(error, 'password_reset_email');
      res.json({ success: true }); // Same generic response as the real controller.
    });
  });
  const response = await fetch(url + '/api/auth/forgot-password', { method: 'POST' });
  await response.json();
  await tick();
  assert.equal(records[0].status, 200);
  assert.equal(records[0].outcome, 'success');
  assert.equal(records[0].level, 'warn');
  assert.equal(records[0].error_stage, 'password_reset_email');
  assert.equal(records[0].error_type, 'AxiosError');
  assert.equal(records[0].upstream_status, 403);
  assert.doesNotMatch(lines[0], /private-|Authorization|config/);
});

test('errors after headers destroy the response without forwarding raw errors to Express', () => {
  const error = new Error('private-payload');
  let closed = false;
  let captured;
  errorHandler(error, { logError(e) { captured = e; } }, {
    headersSent: true, destroy() { closed = true; }
  }, () => assert.fail('must not pass secret-bearing error to default handler'));
  assert.equal(captured, error);
  assert.equal(closed, true);
});
