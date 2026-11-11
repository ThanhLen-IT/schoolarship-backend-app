const { randomUUID } = require('node:crypto');
const { resolveActivity } = require('../utils/activityRoutes');

const roles = new Set(['user', 'mentor', 'admin']);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const errorNames = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'URIError', 'MulterError', 'AxiosError']);
const errorCodes = new Set([
  '23505', '23503', '22P02', '42P01', '42703', 'ECONNREFUSED', 'ETIMEDOUT',
  'ENOENT', 'LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE', 'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE', 'ECONNABORTED',
  'EAUTH', 'ESOCKET', 'ECONNECTION', 'ETLS', 'EENVELOPE', 'EMESSAGE', 'EDNS'
]);
const filterKeys = ['search', 'country', 'continent', 'type', 'study_level', 'major', 'deadline_from', 'deadline_to', 'sort', 'page', 'limit', 'status'];
const relatedIds = ['scholarship_id', 'mentor_id', 'application_id'];
const progressActions = new Set(['accept', 'reject', 'start', 'complete']);

function positiveId(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,20}$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function actor(user) {
  return {
    user_id: positiveId(user?.id),
    user_role: roles.has(user?.role) ? user.role : null
  };
}

/**
 * One JSON line after a response finishes (or the connection is aborted).
 * This is an allowlist: never serialize req, headers, body, query values,
 * response objects, filenames, error.message or error.stack into the journal.
 */
function createRequestLogger({ write = line => process.stdout.write(line) } = {}) {
  return function requestLogger(req, res, next) {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    const method = methods.has(req.method) ? req.method : 'OTHER';
    const pathname = (req.originalUrl || req.url || '').split('?')[0];
    const activity = resolveActivity(method, pathname);
    const authentication = activity.action === 'auth.login' || activity.action === 'auth.register';
    let responseSuccess;
    let loginActor;
    let responseId;
    let liked;
    let errorInfo;
    let written = false;

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    req.logError = (error, stage) => {
      errorInfo = {
        error_type: errorNames.has(error?.name) ? error.name : 'Error'
      };
      if (errorCodes.has(error?.code)) errorInfo.error_code = error.code;
      if (stage === 'password_reset_email') errorInfo.error_stage = stage;
      if (stage === 'password_reset_email' && Number.isInteger(error?.responseCode) &&
          error.responseCode >= 400 && error.responseCode <= 599) {
        errorInfo.smtp_status = error.responseCode;
      }
      if (Number.isInteger(error?.response?.status) && error.response.status >= 400 && error.response.status <= 599) {
        errorInfo.upstream_status = error.response.status;
      }
    };

    // Copy only safe primitives, not the response body that contains JWTs,
    // profile details, content, email addresses or password-reset information.
    const originalJson = res.json;
    res.json = function loggedJson(body) {
      if (typeof body?.success === 'boolean') responseSuccess = body.success;
      if (authentication && body?.success === true && res.statusCode >= 200 && res.statusCode < 300) {
        loginActor = actor(body.data?.user);
      }
      responseId = positiveId(body?.data?.id);
      if (typeof body?.is_liked === 'boolean') liked = body.is_liked;
      return originalJson.call(this, body);
    };

    function record(aborted) {
      if (written) return;
      written = true;
      const status = aborted ? null : res.statusCode;
      const successful = !aborted && status >= 200 && status < 400 && responseSuccess !== false;
      const outcome = aborted ? 'aborted' : successful ? 'success' : status >= 500 ? 'error' : 'rejected';
      const entry = {
        timestamp: new Date().toISOString(),
        level: outcome === 'error' ? 'error' : successful && !errorInfo ? 'info' : 'warn',
        event: 'http.request',
        request_id: requestId,
        method,
        route: activity.route,
        action: activity.action,
        ...(req.user ? actor(req.user) : successful && loginActor ? loginActor : actor(null)),
        status,
        outcome,
        duration_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100
      };
      const targetId = positiveId(activity.pathId) || (!authentication && successful ? responseId : null);
      if (targetId) entry.target_id = targetId;
      const query = req.query || {};
      const body = req.body || {};
      for (const key of relatedIds) {
        const id = positiveId(query[key]) || positiveId(body[key]);
        if (id) entry[key] = id;
      }
      const filters = filterKeys.filter(key => Object.hasOwn(query, key));
      if (filters.length) entry.filter_keys = filters;
      if (activity.action === 'mentoring.progress.update' && progressActions.has(req.body?.action)) {
        entry.operation = req.body.action;
      }
      if (successful && activity.action === 'community.post.like_toggle' && liked !== undefined) {
        entry.action = liked ? 'community.post.like' : 'community.post.unlike';
      }
      if (errorInfo) Object.assign(entry, errorInfo);

      // A failed logging sink must never change an API response or trigger
      // another error log containing raw request data.
      try { write(JSON.stringify(entry) + '\n'); } catch (_) { /* sink unavailable */ }
    }

    res.once('finish', () => record(false));
    res.once('close', () => { if (!res.writableFinished) record(true); });
    next();
  };
}

module.exports = { createRequestLogger };
