const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestMetrics } = require('../src/services/requestMetrics');

const HOUR_MS = 60 * 60 * 1000;

test('metrics group completed requests by hour and only retain safe error fields', () => {
  let time = Date.UTC(2026, 10, 18, 12, 30);
  const metrics = createRequestMetrics(() => time);
  metrics.record({ status: 200, duration_ms: 7 });
  metrics.record({ status: 401, duration_ms: 63 });
  time += HOUR_MS;
  const error = {
    timestamp: new Date(time).toISOString(),
    request_id: 'fixture-request',
    method: 'GET',
    route: '/api/scholarships/:id',
    status: 503,
    duration_ms: 177,
  };
  metrics.record({ ...error, user_id: 42, target_id: 12, privateField: 'secret' });

  const result = metrics.snapshot();
  assert.deepEqual(result.summary, { requests: 3, clientErrors: 1, serverErrors: 1, p95Ms: 177 });
  assert.deepEqual(result.series.map((point) => point.requests), [2, 1]);
  assert.deepEqual(result.recentErrors, [error]);
});

test('metrics keep at most 24 hourly buckets and 30 recent errors', () => {
  let time = Date.UTC(2026, 10, 18);
  const metrics = createRequestMetrics(() => time);
  for (let id = 0; id < 31; id++) {
    metrics.record({
      timestamp: new Date(time).toISOString(),
      request_id: String(id),
      status: 500,
      duration_ms: 10,
    });
  }
  assert.equal(metrics.snapshot().recentErrors.length, 30);
  assert.equal(metrics.snapshot().recentErrors[0].request_id, '30');

  time += 24 * HOUR_MS;
  metrics.record({ status: 204, duration_ms: 17 });
  const result = metrics.snapshot();
  assert.equal(result.series.length, 24);
  assert.equal(result.series[0].p95Ms, null);
  assert.deepEqual(result.summary, { requests: 1, clientErrors: 0, serverErrors: 0, p95Ms: 17 });
  assert.deepEqual(result.recentErrors, []);
});
