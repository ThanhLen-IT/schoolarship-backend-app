const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStudyLevels, isValidISODate, sanitizeScholarshipHtml
} = require('../src/utils/scholarshipContent');

test('Vietnamese study levels map to canonical mobile API enum', () => {
  assert.deepEqual(
    normalizeStudyLevels(['Cử nhân', 'Thạc sĩ', 'Tiến sĩ', 'Trao đổi ngắn hạn']),
    ['bachelor', 'master', 'doctoral', 'other']
  );
  assert.deepEqual(normalizeStudyLevels(['bachelor', 'bachelor']), ['bachelor']);
  assert.deepEqual(normalizeStudyLevels('Cử nhân; Thạc sĩ'), ['bachelor', 'master']);
  assert.throws(() => normalizeStudyLevels(['unknown-level']), /không hợp lệ/);
  assert.throws(() => normalizeStudyLevels([]), /hợp lệ/);
});

test('ISO date validation handles calendar ranges', () => {
  assert.equal(isValidISODate('2028-02-29'), true);
  assert.equal(isValidISODate('2027-02-29'), false);
  assert.equal(isValidISODate('2027-13-01'), false);
  assert.equal(isValidISODate('2027-11-31'), false);
  assert.equal(isValidISODate(null), true);
});

test('HTML sanitizer drops executable tags and event attributes', () => {
  const actual = sanitizeScholarshipHtml(
    '<div onclick="alert(1)">OK<script>alert(1)</script>' +
    '<iframe src="https://evil.example"></iframe>' +
    '<img src="javascript:alert(1)" onerror="alert(1)">' +
    '<a href="javascript:alert(1)" onclick="x()">Click</a>' +
    '</div>'
  );
  assert.match(actual, /OK/);
  assert.match(actual, /Click/);
  assert.doesNotMatch(actual, /<script|<iframe|onerror=|onclick=|javascript:/i);
  assert.doesNotMatch(actual, /<img/i);
});

test('HTML sanitizer keeps safe article content and resolves relative links', () => {
  const actual = sanitizeScholarshipHtml(
    '<p style="color:red">Study <b>abroad</b></p>' +
    '<a href="/scholarship" target="_blank">Apply</a>' +
    '<img src="/cover.jpg" alt="Cover" onload="alert(1)">',
    'https://ybox.vn/home'
  );
  assert.match(actual, /<b>abroad<\/b>/);
  assert.match(actual, /https:\/\/ybox\.vn\/scholarship/);
  assert.match(actual, /https:\/\/ybox\.vn\/cover\.jpg/);
  assert.doesNotMatch(actual, /style=|onload=|target=/i);
});

test('HTML sanitizer rejects oversized input', () => {
  assert.throws(
    () => sanitizeScholarshipHtml('x'.repeat(2_000_001)),
    /content_html/
  );
});
