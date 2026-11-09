const { sanitizeScholarshipHtml } = require('./scholarshipContent');

// One response shape for anonymous scholarship browsing and authenticated bookmarks.
// Never return untrusted original HTML or internal review metadata to Mobile clients.
function toPublicScholarship(row) {
  const {
    original_content_html,
    reviewed_by,
    reviewed_at,
    rejection_reason,
    ...publicData
  } = row;
  return {
    ...publicData,
    content_html: sanitizeScholarshipHtml(publicData.content_html, publicData.source_url)
  };
}

module.exports = { toPublicScholarship };
