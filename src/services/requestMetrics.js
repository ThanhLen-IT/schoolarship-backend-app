const HOUR_MS = 60 * 60 * 1000;
const HOURS = 24;
const RECENT_ERRORS = 30;
const LATENCY_BOUNDS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

function newBucket(hour) {
  return {
    hour, requests: 0, clientErrors: 0, serverErrors: 0, maxDuration: 0,
    latency: Array(LATENCY_BOUNDS_MS.length + 1).fill(0),
  };
}

function p95(bucket) {
  if (!bucket.requests) return null;
  const rank = Math.ceil(bucket.requests * 0.95);
  let samples = 0;
  for (const [index, count] of bucket.latency.entries()) {
    samples += count;
    if (samples >= rank) return Math.min(bucket.maxDuration, LATENCY_BOUNDS_MS[index] ?? Infinity);
  }
}

function createRequestMetrics(now = Date.now) {
  const startedAt = now();
  const buckets = Array(HOURS);
  const recentErrors = [];

  function record({ timestamp, request_id, method, route, status, duration_ms }) {
    const hour = Math.floor(now() / HOUR_MS);
    const slot = hour % HOURS;
    if (buckets[slot]?.hour !== hour) buckets[slot] = newBucket(hour);
    const bucket = buckets[slot];
    bucket.requests++;
    bucket.maxDuration = Math.max(bucket.maxDuration, duration_ms);
    const latencyIndex = LATENCY_BOUNDS_MS.findIndex((bound) => duration_ms <= bound);
    bucket.latency[latencyIndex < 0 ? LATENCY_BOUNDS_MS.length : latencyIndex]++;
    if (status >= 500) bucket.serverErrors++;
    else if (status >= 400) bucket.clientErrors++;

    if (status >= 500) {
      recentErrors.unshift({ timestamp, request_id, method, route, status, duration_ms });
      if (recentErrors.length > RECENT_ERRORS) recentErrors.pop();
    }
  }

  function snapshot() {
    const currentTime = now();
    const currentHour = Math.floor(currentTime / HOUR_MS);
    const firstHour = Math.max(currentHour - HOURS + 1, Math.floor(startedAt / HOUR_MS));
    const total = newBucket(firstHour);
    const series = [];
    for (let hour = firstHour; hour <= currentHour; hour++) {
      const slot = buckets[hour % HOURS];
      const bucket = slot?.hour === hour ? slot : newBucket(hour);
      total.requests += bucket.requests;
      total.clientErrors += bucket.clientErrors;
      total.serverErrors += bucket.serverErrors;
      total.maxDuration = Math.max(total.maxDuration, bucket.maxDuration);
      bucket.latency.forEach((count, index) => { total.latency[index] += count; });
      series.push({
        from: new Date(hour * HOUR_MS).toISOString(),
        requests: bucket.requests,
        clientErrors: bucket.clientErrors,
        serverErrors: bucket.serverErrors,
        p95Ms: p95(bucket),
      });
    }
    return {
      startedAt: new Date(startedAt).toISOString(),
      collectedAt: new Date(currentTime).toISOString(),
      summary: {
        requests: total.requests,
        clientErrors: total.clientErrors,
        serverErrors: total.serverErrors,
        p95Ms: p95(total),
      },
      series,
      recentErrors: recentErrors.filter((entry) => Date.parse(entry.timestamp) >= firstHour * HOUR_MS),
    };
  }

  return { record, snapshot };
}

module.exports = { createRequestMetrics };
