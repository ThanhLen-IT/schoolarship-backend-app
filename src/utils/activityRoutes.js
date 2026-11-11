// Static names keep user input (URLs, queries and search text) out of the journal.
// Add an entry here when adding a route that needs a specific activity name.
const routes = [
  ['POST', '/api/auth/register', 'auth.register'],
  ['POST', '/api/auth/login', 'auth.login'],
  ['POST', '/api/auth/forgot-password', 'auth.password_reset.request'],
  ['POST', '/api/auth/reset-password', 'auth.password_reset.confirm'],
  ['GET', '/api/auth/me', 'user.profile.view'],
  ['PUT', '/api/users/profile', 'user.profile.update'],
  ['PATCH', '/api/users/mentor-status', 'user.mentor_status.change'],
  ['GET', '/api/users/saved', 'scholarship.saved.list'],
  ['POST', '/api/users/saved/:scholarshipId', 'scholarship.save'],
  ['DELETE', '/api/users/saved/:scholarshipId', 'scholarship.unsave'],
  ['GET', '/api/scholarships', 'scholarship.search'],
  ['GET', '/api/scholarships/:id', 'scholarship.view'],
  ['POST', '/api/scholarships', 'admin.scholarship.create'],
  ['GET', '/api/mentors', 'mentor.search'],
  ['GET', '/api/mentors/ranking', 'mentor.ranking.view'],
  ['GET', '/api/mentors/verify/status', 'mentor.verification.status'],
  ['POST', '/api/mentors/verify', 'mentor.verification.submit'],
  ['GET', '/api/mentors/:id', 'mentor.view'],
  ['POST', '/api/mentors/:id/reviews', 'mentor.review.create'],
  ['GET', '/api/posts', 'community.post.search'],
  ['GET', '/api/posts/:id', 'community.post.view'],
  ['POST', '/api/posts', 'community.post.create'],
  ['POST', '/api/posts/:id/like', 'community.post.like_toggle'],
  ['GET', '/api/posts/:id/comments', 'community.comment.list'],
  ['POST', '/api/posts/:id/comments', 'community.comment.create'],
  ['GET', '/api/mentoring/applications/mine', 'mentoring.application.list'],
  ['POST', '/api/mentoring/applications', 'mentoring.application.create'],
  ['PATCH', '/api/mentoring/applications/:id/progress', 'mentoring.progress.update'],
  ['POST', '/api/mentoring/applications/:id/response-requests', 'mentoring.response_request.create'],
  ['GET', '/api/mentoring/applications/:id/response-requests', 'mentoring.response_request.list'],
  ['PATCH', '/api/mentoring/response-requests/:id/respond', 'mentoring.response_request.respond'],
  ['GET', '/api/admin/mentors/verifications', 'admin.mentor_verification.list'],
  ['PATCH', '/api/admin/mentors/verifications/:id/approve', 'admin.mentor_verification.approve'],
  ['PATCH', '/api/admin/mentors/verifications/:id/reject', 'admin.mentor_verification.reject'],
  ['GET', '/api/admin/mentors/verifications/:id/evidence', 'admin.mentor_evidence.download'],
  ['GET', '/api/admin/scholarships', 'admin.scholarship.list'],
  ['GET', '/api/admin/scholarships/:id', 'admin.scholarship.view'],
  ['POST', '/api/admin/scholarships', 'admin.scholarship.create'],
  ['PUT', '/api/admin/scholarships/:id', 'admin.scholarship.update'],
  ['PATCH', '/api/admin/scholarships/:id/approve', 'admin.scholarship.approve'],
  ['PATCH', '/api/admin/scholarships/:id/reject', 'admin.scholarship.reject'],
  ['PATCH', '/api/admin/scholarships/:id/archive', 'admin.scholarship.archive'],
  ['DELETE', '/api/admin/scholarships/:id', 'admin.scholarship.delete'],
  ['GET', '/api/admin/crawler/sources', 'admin.crawler.sources'],
  ['POST', '/api/admin/crawler/run', 'admin.crawler.run'],
  ['GET', '/api/admin/crawler/status', 'admin.crawler.status'],
  ['GET', '/api/admin/crawler/logs', 'admin.crawler.logs'],
  ['GET', '/api/admin/crawler/pending-scholarships', 'admin.scholarship.pending_list'],
  ['PUT', '/api/admin/crawler/scholarships/:id', 'admin.scholarship.update'],
  ['POST', '/api/admin/crawler/scholarships/:id/approve', 'admin.scholarship.approve'],
  ['POST', '/api/admin/crawler/scholarships/:id/reject', 'admin.scholarship.reject'],
  ['PATCH', '/api/admin/mentoring/applications/:id/outcome', 'admin.mentoring.outcome.record'],
  ['GET', '/health', 'health.live'],
  ['GET', '/health/ready', 'health.ready'],
  ['GET', '/health/midterm', 'health.midterm'],
  ['GET', '/', 'service.info']
].map(([method, route, action]) => ({
  method,
  route,
  action,
  pattern: new RegExp('^' + route.replace(/:[A-Za-z]+/g, '([^/]+)') + '/?$', 'i')
}));

function resolveActivity(method, pathname) {
  // Express also serves GET routes for HEAD. CORS may complete OPTIONS before
  // the router runs, and authentication may reject a request in router.use().
  // Resolve from static route patterns so those requests still get a safe label.
  const effectiveMethod = method === 'HEAD' ? 'GET' : method;
  const entry = routes.find(route =>
    (method === 'OPTIONS' || route.method === effectiveMethod) && route.pattern.test(pathname)
  );
  if (!entry) return { route: '[unmatched]', action: 'http.request' };
  return {
    route: entry.route,
    action: method === 'OPTIONS' ? 'http.preflight' : entry.action,
    pathId: entry.pattern.exec(pathname)[1]
  };
}

module.exports = { resolveActivity };
