const cheerio = require('cheerio');

function isYboxSource(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      ['ybox.vn', 'www.ybox.vn'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

// The surrounding .content-wrapper also contains the author's profile,
// recommendations, reactions and advertisements. It is never an article body.
function extractYboxArticle(html) {
  if (typeof html !== 'string' || html.length > 2_000_000) {
    throw new Error('HTML YBOX không hợp lệ hoặc quá lớn.');
  }
  const $ = cheerio.load(html, {}, false);
  const article = $('#post-content');
  const visible = article.clone();
  visible.find('script, style, iframe, object, embed, template, noscript').remove();
  if (article.length !== 1 || !visible.text().trim()) {
    throw new Error('Không tìm thấy nội dung bài YBOX (#post-content); không lấy toàn bộ trang thay thế.');
  }
  return $.html(article);
}

module.exports = { isYboxSource, extractYboxArticle };
