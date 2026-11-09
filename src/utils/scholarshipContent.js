const cheerio = require('cheerio');

const LEVEL_ALIASES = new Map([
  ['bachelor', 'bachelor'], ['cử nhân', 'bachelor'],
  ['master', 'master'], ['thạc sĩ', 'master'],
  ['doctoral', 'doctoral'], ['phd', 'doctoral'], ['tiến sĩ', 'doctoral'],
  ['all', 'all'], ['tất cả', 'all'],
  ['other', 'other'], ['trao đổi ngắn hạn', 'other'],
  ['unknown', 'unknown'], ['không rõ', 'unknown']
]);

function normalizeStudyLevels(value) {
  const input = typeof value === 'string' ? value.split(/[,;\n]/) : value;
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('study_levels phải là một danh sách bậc học hợp lệ.');
  }
  const levels = [];
  for (const item of input) {
    if (typeof item !== 'string') {
      throw new Error('Mỗi bậc học phải là một chuỗi.');
    }
    const value = item.trim().toLowerCase();
    if (!value) continue;
    const canonical = LEVEL_ALIASES.get(value);
    if (!canonical) throw new Error('Bậc học không hợp lệ: ' + item);
    if (!levels.includes(canonical)) levels.push(canonical);
  }
  if (levels.length === 0) throw new Error('Phải chọn ít nhất một bậc học.');
  return levels;
}

function isValidISODate(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const allowedTags = new Set([
  'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'small', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'a', 'img', 'sup', 'sub'
]);

const blockedTags = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'form', 'input', 'button', 'select', 'option', 'textarea',
  'svg', 'math', 'meta', 'link', 'base', 'template', 'noscript',
  'audio', 'video', 'source', 'canvas'
]);

function safeUrl(raw, sourceUrl) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = new URL(raw, sourceUrl || undefined);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function sanitizeScholarshipHtml(rawHtml, sourceUrl = null) {
  if (rawHtml === null || rawHtml === undefined || rawHtml === '') return null;
  if (typeof rawHtml !== 'string' || rawHtml.length > 2_000_000) {
    throw new Error('content_html phải là chuỗi HTML tối đa 2 triệu ký tự.');
  }

  // No document wrapper, preserving article fragments.
  const $ = cheerio.load(rawHtml, {}, false);

  // Visit children before parents; removed unsafe containers drop their contents.
  const elements = $('*').toArray().reverse();
  for (const element of elements) {
    const tag = String(element.tagName || element.name || '').toLowerCase();
    const node = $(element);

    if (blockedTags.has(tag)) {
      node.remove();
      continue;
    }
    if (!allowedTags.has(tag)) {
      node.replaceWith(node.contents());
      continue;
    }

    const href = tag === 'a' ? node.attr('href') : null;
    const src = tag === 'img' ? node.attr('src') : null;
    const alt = tag === 'img' ? node.attr('alt') : null;
    for (const attribute of Object.keys(element.attribs || {})) {
      node.removeAttr(attribute);
    }

    if (tag === 'a') {
      const safe = safeUrl(href, sourceUrl);
      if (safe) {
        node.attr('href', safe);
        node.attr('rel', 'noopener noreferrer');
      }
    }
    if (tag === 'img') {
      const safe = safeUrl(src, sourceUrl);
      if (!safe) {
        node.remove();
        continue;
      }
      node.attr('src', safe);
      if (alt) node.attr('alt', alt.slice(0, 250));
      node.attr('loading', 'lazy');
    }
  }
  return $.root().html();
}

module.exports = {
  normalizeStudyLevels,
  isValidISODate,
  sanitizeScholarshipHtml
};
