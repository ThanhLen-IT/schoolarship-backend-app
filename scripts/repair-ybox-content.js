require('dotenv').config({ quiet: true });
const { isYboxSource, extractYboxArticle } = require('../src/utils/yboxContent');
const { sanitizeScholarshipHtml } = require('../src/utils/scholarshipContent');

function planRepair(row) {
  if (!isYboxSource(row.source_url)) return { status: 'skipped', reason: 'Không phải nguồn YBOX.' };
  let article;
  try { article = extractYboxArticle(row.original_content_html); }
  catch { return { status: 'skipped', reason: 'HTML gốc không còn phần #post-content; cần chỉnh thủ công.' }; }
  const cleaned = sanitizeScholarshipHtml(article, row.source_url);
  const current = sanitizeScholarshipHtml(row.content_html, row.source_url);
  if (current === cleaned) return { status: 'unchanged', reason: 'Nội dung đã sạch.' };
  // Never overwrite the admin's custom article with an older source version.
  if (current !== sanitizeScholarshipHtml(row.original_content_html, row.source_url)) {
    return { status: 'skipped', reason: 'Nội dung đã được chỉnh sửa; giữ nguyên để admin kiểm tra.' };
  }
  return { status: 'repairable', content: cleaned };
}

async function repairYboxContent(client, { id, apply = false }) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Cần --id là ID học bổng nguyên dương.');
  await client.query('BEGIN');
  try {
    const result = await client.query(
      'SELECT id, title, source_url, content_html, original_content_html FROM scholarships WHERE id=$1 FOR UPDATE', [id],
    );
    if (!result.rows.length) throw new Error('Không tìm thấy học bổng.');
    const row = result.rows[0];
    const plan = planRepair(row);
    if (apply && plan.status === 'repairable') {
      await client.query('UPDATE scholarships SET content_html=$2, updated_at=NOW() WHERE id=$1', [id, plan.content]);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return {
      id, title: row.title, status: plan.status, applied: apply && plan.status === 'repairable',
      reason: plan.reason,
      beforeCharacters: row.content_html?.length || 0,
      afterCharacters: plan.content?.length,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--dry-run'].includes(arg) && !/^--id=[1-9][0-9]*$/.test(arg)) ||
      args.filter(arg => arg.startsWith('--id=')).length !== 1 ||
      (args.includes('--apply') && args.includes('--dry-run'))) {
    throw new Error('Dùng --id=ID --dry-run hoặc --id=ID --apply.');
  }
  if (!process.env.DB_NAME) throw new Error('Thiếu DB_NAME trong cấu hình.');
  const { Client } = require('pg');
  const client = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  try {
    await client.connect();
    const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (actual !== process.env.DB_NAME) throw new Error('Database thực tế không khớp DB_NAME.');
    console.log('Database đích: ' + actual);
    const result = await repairYboxContent(client, {
      id: Number(args.find(arg => arg.startsWith('--id=')).slice(5)), apply: args.includes('--apply'),
    });
    console.log(JSON.stringify(result, null, 2));
    console.log(result.applied ? 'Đã sửa nội dung YBOX; giữ nguyên thông tin, trạng thái duyệt và HTML gốc.' : 'Chưa thay đổi dữ liệu. Chỉ --apply mới lưu bản sửa nếu status=repairable.');
  } finally { await client.end().catch(() => {}); }
}

if (require.main === module) main().catch(error => {
  console.error('Không thể sửa nội dung: ' + (error.code ? 'DB error ' + error.code : error.message));
  process.exitCode = 1;
});
module.exports = { planRepair, repairYboxContent };
