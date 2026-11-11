const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { isYboxSource, extractYboxArticle } = require('../src/utils/yboxContent');
const { sanitizeScholarshipHtml } = require('../src/utils/scholarshipContent');
const { planRepair, repairYboxContent } = require('../scripts/repair-ybox-content');

const url = 'https://ybox.vn/hoc-bong/synthetic-program';
const article = '<div id="post-content"><h2>Học bổng nghiên cứu</h2>' +
  '<p>Thông tin chương trình thử nghiệm.</p><ul><li>Hỗ trợ học phí</li></ul>' +
  '<table><tr><td>Hạn nộp</td><td>01/02/2027</td></tr></table>' +
  '<a href="/application">Nộp hồ sơ</a><script>unsafe()</script></div>';
const wrapper = '<div class="content-wrapper"><aside>AUTHOR PROFILE: Followers, Sở thích, Cần tìm bạn</aside>' +
  '<div class="panel-body">' + article + '<div id="ybox-add-footer">ADVERTISEMENT</div>' +
  '<p>REACTIONS: Thích, Chia sẻ, Lưu bài</p></div><div>RECOMMENDATIONS</div></div>';

test('YBOX article extraction excludes profile, advertising, reactions and recommendations while preserving article structure', () => {
  const extracted = extractYboxArticle(wrapper);
  const safe = sanitizeScholarshipHtml(extracted, url);
  assert.match(safe, /Học bổng nghiên cứu/);
  assert.match(safe, /<ul><li>Hỗ trợ học phí/);
  assert.match(safe, /<table>/);
  assert.match(safe, /https:\/\/ybox.vn\/application/);
  assert.doesNotMatch(safe, /AUTHOR PROFILE|ADVERTISEMENT|REACTIONS|RECOMMENDATIONS|unsafe|<script/);
});

test('YBOX extraction never falls back to a page wrapper when the article is missing or empty', () => {
  for (const html of ['<div class="content-wrapper">Profile only</div>', '<div id="post-content"></div>',
    '<div id="post-content"><script>Not an article</script></div>', article + article]) {
    assert.throws(() => extractYboxArticle(html), /Không tìm thấy/);
  }
  assert.equal(isYboxSource(url), true);
  assert.equal(isYboxSource('https://www.ybox.vn/hoc-bong/test'), true);
  assert.equal(isYboxSource('https://ybox.vn.attacker.example/test'), false);
});

test('repair planning preserves admin edits, clean articles, missing originals and other sources', () => {
  const row = { source_url: url, original_content_html: wrapper, content_html: sanitizeScholarshipHtml(wrapper, url) };
  assert.equal(planRepair(row).status, 'repairable');
  assert.equal(planRepair({ ...row, content_html: '<p>Admin-edited scholarship</p>' }).status, 'skipped');
  assert.equal(planRepair({ ...row, source_url: 'https://example.test/post' }).status, 'skipped');
  assert.equal(planRepair({ ...row, original_content_html: null }).status, 'skipped');
  assert.equal(planRepair({ ...row, content_html: sanitizeScholarshipHtml(article, url) }).status, 'unchanged');
});

test('existing scholarship repair is dry-run by default, preserves publication and original HTML, and rolls back failed writes', { timeout: 60000 }, async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await fs.readFile(path.join(__dirname, 'fixtures/database-v1-schema.sql'), 'utf8'));
  await db.exec('SET search_path TO public');
  const row = (await db.query(`INSERT INTO scholarships(title, source_url, status, country, content_html, original_content_html)
    VALUES($1, $2, 'published', 'Japan', $3, $4) RETURNING *`,
  ['Admin-edited title', url, sanitizeScholarshipHtml(wrapper, url), wrapper])).rows[0];
  const read = async () => (await db.query('SELECT * FROM scholarships WHERE id=$1', [row.id])).rows[0];
  assert.equal((await repairYboxContent(db, { id: row.id })).applied, false);
  assert.deepEqual(await read(), row);
  await assert.rejects(repairYboxContent({ query(sql, args) {
    if (sql.startsWith('UPDATE scholarships')) throw new Error('fixture write failure');
    return db.query(sql, args);
  } }, { id: row.id, apply: true }), /fixture write failure/);
  assert.deepEqual(await read(), row);
  assert.equal((await repairYboxContent(db, { id: row.id, apply: true })).applied, true);
  const repaired = await read();
  const { content_html: before, updated_at: oldDate, ...oldFields } = row;
  const { content_html: after, updated_at: newDate, ...newFields } = repaired;
  assert.deepEqual(newFields, oldFields);
  assert.doesNotMatch(after, /AUTHOR PROFILE|ADVERTISEMENT|REACTIONS|RECOMMENDATIONS/);
  assert.match(after, /Học bổng nghiên cứu/);
  assert.equal((await repairYboxContent(db, { id: row.id, apply: true })).status, 'unchanged');
  await assert.rejects(repairYboxContent(db, { id: row.id + 100 }), /Không tìm thấy/);
});

test('crawler saves only article HTML, skips failed detail pages and reports completed_with_errors', { timeout: 15000 }, async t => {
  const dbKey = require.resolve('../src/config/db');
  const browserKey = require.resolve('puppeteer');
  const crawlerKey = require.resolve('../src/services/crawlerService');
  const previous = [dbKey, browserKey, crawlerKey].map(key => require.cache[key]);
  t.after(() => [dbKey, browserKey, crawlerKey].forEach((key, i) => {
    if (previous[i]) require.cache[key] = previous[i]; else delete require.cache[key];
  }));
  const writes = [];
  const fakePool = { async query(sql, args) {
    writes.push({ sql, args });
    return { rows: [{ id: 1 }], rowCount: 1 };
  } };
  let currentUrl;
  const fakePage = {
    async goto(value) { currentUrl = value; },
    url() { return currentUrl; },
    async content() {
      return '<div class="post--article"><a class="community">@Học bổng</a><h2><a href="/hoc-bong/good">Good</a></h2></div>' +
        '<div class="post--article"><a class="community">@Học bổng</a><h2><a href="/hoc-bong/missing">Missing</a></h2></div>';
    },
    async waitForSelector(selector) {
      assert.equal(selector, '#post-content');
      if (currentUrl.endsWith('/missing')) throw new Error('article not found');
    },
    async evaluate(fn, selector) { assert.equal(selector, '#post-content'); return article; },
  };
  const browser = { async newPage() { return fakePage; }, async close() {} };
  require.cache[dbKey] = { id: dbKey, filename: dbKey, loaded: true, exports: fakePool };
  require.cache[browserKey] = { id: browserKey, filename: browserKey, loaded: true, exports: { async launch() { return browser; } } };
  delete require.cache[crawlerKey];
  const configs = require('../src/config/crawlerConfig');
  assert.ok(configs.every(config => config.selectors.detailContent === '#post-content'));
  const result = await require('../src/services/crawlerService').crawlScholarships({
    ...configs[0], sourceUrl: 'https://ybox.vn/list', initialWait: 0, steps: [],
    selectors: { item: '.post--article', title: 'h2 a', link: 'h2 a', detailContent: '#post-content' },
  });
  assert.deepEqual({ found: result.found, saved: result.saved, failed: result.failed, status: result.status },
    { found: 2, saved: 1, failed: 1, status: 'completed_with_errors' });
  const inserts = writes.filter(item => /INSERT INTO scholarships \(/.test(item.sql));
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].args[7], /id="post-content"/);
  assert.doesNotMatch(inserts[0].args[8], /<script|unsafe/);
  const finished = writes.filter(item => /UPDATE scholarship_crawl_logs/.test(item.sql)).at(-1);
  assert.equal(finished.args[4], 'completed_with_errors');
});
