require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

const PREFIX = 'https://demo.global-success.invalid/v1';
const ADMIN = 'admin@global-success.demo.invalid';
const TABLES = ['users', 'scholarships', 'mentor_verifications', 'mentee_applications',
  'mentor_reviews', 'mentoring_response_requests', 'saved_scholarships', 'posts',
  'comments', 'post_likes', 'conversations', 'chat_messages', 'notifications',
  'support_tickets', 'transactions', 'scholarship_crawl_logs', 'app_events'];

function validateTarget(env, args = []) {
  if (!env.DB_NAME?.trim()) throw new Error('Thiếu DB_NAME trong cấu hình.');
  if (!args.includes('--allow-current-db') &&
      (env.NODE_ENV === 'production' || !/_(demo|test)$/.test(env.DB_NAME))) {
    throw new Error('Mặc định chỉ nạp vào database _demo/_test ngoài production. Để thêm dataset vào database hiện tại, dùng --allow-current-db.');
  }
  const bytes = Buffer.byteLength(env.DEMO_PASSWORD || '', 'utf8');
  if (bytes < 12 || bytes > 72) throw new Error('Đặt DEMO_PASSWORD từ 12 đến 72 byte UTF-8.');
}

// Small, valid, text-only PDF fixture; contains no real personal information.
function demoPdf() {
  const stream = 'BT /F1 18 Tf 50 780 Td (GLOBAL SUCCESS - DEMO CV) Tj 0 -32 Td /F1 11 Tf (Synthetic test document. Not a real application.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(output + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

async function insert(client, table, values) {
  if (!TABLES.includes(table)) throw new Error('Unknown fixture table');
  const keys = Object.keys(values);
  const result = await client.query(
    `INSERT INTO ${table} (${keys.map(k => '"' + k + '"').join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
    Object.values(values),
  );
  return result.rows[0];
}

async function counts(client) {
  const result = {};
  for (const table of TABLES) result[table] = Number((await client.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  return result;
}

async function seedDemo(client, { password, apply = false, baseDate = new Date(), uploadDir = path.join(__dirname, '../uploads') }) {
  if (Buffer.byteLength(password || '', 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Mật khẩu demo không hợp lệ.');
  const anchor = new Date(baseDate);
  if (Number.isNaN(anchor.getTime())) throw new Error('DEMO_DATE không hợp lệ.');
  anchor.setUTCHours(12, 0, 0, 0);
  const at = (days, minutes = 0) => new Date(anchor.getTime() + days * 86400000 + minutes * 60000).toISOString();
  const files = [];
  let committed = false;
  await client.query('BEGIN');
  try {
    // Fail before writing when the base schema or mobile migrations are missing.
    await client.query('SELECT mentoring_started_at, outcome_verified_by FROM mentee_applications LIMIT 0');
    await client.query('SELECT client_message_id FROM chat_messages LIMIT 0');
    const existing = await client.query('SELECT id FROM users WHERE email=$1', [ADMIN]);
    const marker = await client.query('SELECT id FROM scholarships WHERE source_url=$1', [PREFIX + '/scholarships/1']);
    if (existing.rows.length || marker.rows.length) {
      if (!existing.rows.length || !marker.rows.length) throw new Error('Có một phần dữ liệu demo hoặc email bị trùng. Dừng để kiểm tra; không ghi đè dữ liệu đang có.');
      await client.query('ROLLBACK');
      return { alreadySeeded: true, adminEmail: ADMIN, scholarshipId: marker.rows[0].id };
    }
    const before = await counts(client);
    const hash = await bcrypt.hash(password, 12);
    const universities = ['ĐH Công nghệ Thông tin', 'ĐH Kinh tế Quốc dân', 'ĐH Bách khoa', 'ĐH Khoa học Tự nhiên'];
    const majors = ['Công nghệ thông tin', 'Kinh tế', 'Kỹ thuật', 'Khoa học dữ liệu', 'Ngôn ngữ Anh'];
    const createUser = async (email, name, username, role = 'user', extra = {}) => insert(client, 'users', {
      email, password_hash: hash, full_name: '[DEMO] ' + name, username,
      role, is_mentor: role === 'mentor', is_active: true, created_at: at(-35),
      university: universities[0], major: majors[0], bio: 'Hồ sơ giả lập để kiểm thử Global Success.',
      skills: ['Tiếng Anh', 'Viết luận'], ...extra,
    });
    const admin = await createUser(ADMIN, 'Quản trị viên', 'gsdemo_admin', 'admin');
    const mentors = [];
    for (let i = 0; i < 6; i++) mentors.push(await createUser(
      `mentor${String(i + 1).padStart(2, '0')}@global-success.demo.invalid`,
      ['Minh Anh', 'Quốc Bảo', 'Thu Hà', 'Gia Huy', 'Hải Yến', 'Tuấn Kiệt'][i],
      'gsdemo_mentor' + (i + 1), i < 4 ? 'mentor' : 'user', { university: universities[i % 4] },
    ));
    const students = [];
    for (let i = 0; i < 40; i++) students.push(await createUser(
      `student${String(i + 1).padStart(2, '0')}@global-success.demo.invalid`,
      ['Nguyễn Hoàng An', 'Trần Ngọc Bình', 'Lê Minh Châu', 'Phạm Khánh Duy', 'Võ Mai Linh'][i % 5] + ' ' + (i + 1),
      'gsdemo_student' + (i + 1), 'user', {
        university: i % 7 === 0 ? null : universities[i % 4],
        major: i % 7 === 0 ? null : majors[i % 5], bio: i % 7 === 0 ? null : 'Mong muốn tìm học bổng phù hợp và được Mentor góp ý hồ sơ.',
        skills: i % 7 === 0 ? null : ['Tiếng Anh', majors[i % 5]], created_at: at(-70 + i),
      },
    ));
    await createUser('inactive@global-success.demo.invalid', 'Tài khoản bị vô hiệu hóa', 'gsdemo_inactive', 'user', { is_active: false });

    const places = [['Japan', 'Asia'], ['South Korea', 'Asia'], ['Vietnam', 'Asia'], ['Australia', 'Oceania'], ['Germany', 'Europe'], ['France', 'Europe'], ['United States', 'North America'], ['Canada', 'North America'], ['Brazil', 'South America'], ['South Africa', 'Africa']];
    const statuses = ['published', 'published', 'published', 'published', 'published', 'pending', 'pending', 'pending', 'rejected', 'archived'];
    const levels = [['bachelor'], ['master'], ['doctoral'], ['all'], ['other'], ['unknown'], ['bachelor', 'master']];
    const scholarships = [];
    for (let i = 0; i < 60; i++) {
      const [country, continent] = places[(i + Math.floor(i / 10)) % places.length];
      const status = statuses[i % statuses.length];
      const offset = [45, 1, -14, 120, null, 7, 90][i % 7];
      const html = `<h2>Chương trình học bổng thử nghiệm ${i + 1}</h2><p><strong>DỮ LIỆU GIẢ LẬP</strong> — phục vụ kiểm thử Global Success, không phải thông báo tuyển sinh thật.</p><h3>Quyền lợi</h3><ul><li>Hỗ trợ học phí theo chương trình.</li><li>Tư vấn chuẩn bị hồ sơ và bài luận.</li></ul><h3>Điều kiện</h3><p>Ứng viên chuẩn bị bảng điểm, CV và chứng chỉ ngoại ngữ.</p><table><tr><th>Quốc gia</th><th>Chuyên ngành</th></tr><tr><td>${country}</td><td>${majors[i % 5]}</td></tr></table>`;
      scholarships.push(await insert(client, 'scholarships', {
        title: `[DEMO] Global Success ${country} — Chương trình ${String(i + 1).padStart(2, '0')}`,
        organization: '[DEMO] International Education Foundation ' + (i % 8 + 1),
        country, continent, type: ['full', 'partial', 'exchange'][i % 3],
        study_levels: levels[i % levels.length], majors: [majors[i % 5]],
        deadline: offset === null ? null : at(offset).slice(0, 10),
        description: i % 11 === 0 ? 'Học bổng thử nghiệm.' : 'Chương trình giả lập dành cho sinh viên muốn học tập và nghiên cứu trong môi trường quốc tế. '.repeat(5),
        requirements: i % 9 === 0 ? null : 'Bảng điểm; CV; bài luận cá nhân; chứng chỉ ngoại ngữ phù hợp.',
        benefits: 'Hỗ trợ học phí và hướng dẫn chuẩn bị hồ sơ (dữ liệu thử nghiệm).',
        application_link: PREFIX + '/apply/' + (i + 1), source_url: PREFIX + '/scholarships/' + (i + 1),
        source_name: '[DEMO] Global Success Fixtures', status, content_html: html, original_content_html: html,
        created_at: at(-45 + i % 25), updated_at: at(-4), crawled_at: at(-45 + i % 25),
        reviewed_by: status === 'pending' ? null : admin.id, reviewed_at: status === 'pending' ? null : at(-44 + i % 25),
        published_at: status === 'published' ? at(-43 + i % 25) : null,
        rejection_reason: status === 'rejected' ? '[DEMO] Thiếu thông tin về đơn vị cấp học bổng.' : null,
      }));
    }
    const published = scholarships.filter(s => s.status === 'published');
    await fs.mkdir(uploadDir, { recursive: true });
    const cvs = new Map();
    for (const student of students.slice(0, 16)) {
      const filename = `evidence-${student.id}-${Date.now()}-${randomUUID().replaceAll('-', '')}.pdf`;
      const destination = path.join(uploadDir, filename);
      await fs.writeFile(destination, demoPdf(), { flag: 'wx' });
      files.push(destination); cvs.set(student.id, '/private-cv/' + filename);
    }
    for (let i = 0; i < mentors.length; i++) await insert(client, 'mentor_verifications', {
      user_id: mentors[i].id, scholarship_id: published[i < 3 ? 0 : i].id,
      evidence_file_url: PREFIX + '/evidence/mentor-' + (i + 1) + '.pdf',
      status: i < 4 ? 'approved' : i === 4 ? 'pending' : 'rejected',
      hourly_rate: 100000 + i * 25000, admin_note: i === 5 ? '[DEMO] Minh chứng chưa phù hợp.' : null,
      created_at: at(-28),
    });

    const applications = [];
    for (let m = 0; m < 3; m++) {
      for (let i = 0; i < 16; i++) {
        const status = i < 10 ? 'completed' : ['pending', 'accepted', 'in_progress', 'in_progress', 'rejected', 'cancelled'][i - 10];
        const student = students[i];
        const started = status === 'completed' || status === 'in_progress';
        const decided = status === 'completed';
        const app = await insert(client, 'mentee_applications', {
          mentee_id: student.id, mentor_id: mentors[m].id, scholarship_id: published[0].id,
          cv_file_url: cvs.get(student.id), introduction: '[DEMO] Em mong được góp ý bài luận và lộ trình chuẩn bị hồ sơ.',
          status, created_at: at(-24), mentoring_started_at: started ? at(-21) : null,
          mentoring_completed_at: decided ? at(-8) : null,
          scholarship_outcome: decided ? (i < 8 - m ? 'awarded' : 'not_awarded') : 'pending',
          outcome_verified_at: decided ? at(-5) : null, outcome_verified_by: decided ? admin.id : null,
          outcome_note: decided ? '[DEMO] Kết quả giả lập đã được admin xác nhận.' : null,
        });
        applications.push(app);
        if (decided) {
          await insert(client, 'mentor_reviews', { mentor_id: mentors[m].id, mentee_id: student.id,
            application_id: app.id, rating: i < 7 - m ? 5 : 4, comment: '[DEMO] Mentor phản hồi rõ ràng, góp ý bài luận hữu ích.', created_at: at(-7) });
          await insert(client, 'mentoring_response_requests', { application_id: app.id,
            requested_by: student.id, request_note: '[DEMO] Nhờ Mentor xem phần giới thiệu bản thân.', requested_at: at(-18),
            responded_by: i < 9 - m ? mentors[m].id : null, response_note: i < 9 - m ? '[DEMO] Em bổ sung ví dụ cụ thể về dự án đã thực hiện.' : null,
            responded_at: i < 9 - m ? at(-17) : null });
        }
      }
    }
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 2; j++) await insert(client, 'saved_scholarships', { user_id: students[i].id, scholarship_id: published[(i + j) % published.length].id, saved_at: at(-i % 14) });
      await insert(client, 'support_tickets', { user_id: students[i].id,
        subject: '[DEMO] ' + ['Hỗ trợ nộp hồ sơ', 'Góp ý bộ lọc', 'Cập nhật thông tin cá nhân'][i % 3],
        message: '[DEMO] Nhờ đội ngũ Global Success hướng dẫn thao tác và kiểm tra thông tin giúp mình.',
        status: i % 2 ? 'resolved' : 'open', admin_response: i % 2 ? '[DEMO] Đã hướng dẫn và xử lý yêu cầu.' : null,
        created_at: at(-6), resolved_at: i % 2 ? at(-2) : null });
    }
    for (let i = 0; i < 18; i++) {
      const post = await insert(client, 'posts', { author_id: students[i].id, scholarship_id: published[i % published.length].id,
        title: '[DEMO] ' + ['Kinh nghiệm chuẩn bị CV', 'Lộ trình ôn ngoại ngữ', 'Cách viết bài luận cá nhân'][i % 3] + ' ' + (i + 1),
        content: 'Bài viết giả lập để kiểm thử cộng đồng Global Success. Hãy chia sẻ trải nghiệm và đặt câu hỏi bên dưới.',
        like_count: 2, comment_count: 2, created_at: at(-10 + i % 8), updated_at: at(-1) });
      for (let j = 1; j <= 2; j++) {
        await insert(client, 'post_likes', { post_id: post.id, user_id: students[(i + j) % 40].id });
        await insert(client, 'comments', { post_id: post.id, user_id: students[(i + j) % 40].id, content: '[DEMO] Cảm ơn bạn, thông tin rất hữu ích!' });
      }
    }
    for (let i = 0; i < 6; i++) {
      const app = applications[i];
      const ids = [app.mentee_id, app.mentor_id].sort((a, b) => a - b);
      const conversation = await insert(client, 'conversations', { user1_id: ids[0], user2_id: ids[1], created_at: at(-12), last_message: '[DEMO] Mình đã nhận được hồ sơ, bạn nhé.', last_message_at: at(-1, 2) });
      for (let j = 0; j < 4; j++) {
        const sender = j % 2 ? app.mentor_id : app.mentee_id;
        await insert(client, 'chat_messages', { conversation_id: conversation.id, sender_id: sender,
          message: ['[DEMO] Chào Mentor, em muốn hỏi về bài luận.', '[DEMO] Em gửi bản nháp để mình góp ý nhé.', '[DEMO] Em đã cập nhật hồ sơ rồi ạ.', '[DEMO] Mình đã nhận được hồ sơ, bạn nhé.'][j],
          is_read: j < 2, created_at: at(-1, j - 1), client_message_id: randomUUID() });
      }
      await insert(client, 'notifications', { user_id: app.mentee_id, title: '[DEMO] Tin nhắn mới', content: 'Mentor đã phản hồi bạn.', type: 'chat', reference_id: conversation.id, is_read: i % 2 === 0, created_at: at(-1, 2) });
    }
    for (let i = 0; i < 12; i++) await insert(client, 'transactions', {
      application_id: applications[i].id, mentee_id: applications[i].mentee_id, mentor_id: applications[i].mentor_id,
      amount: 100000 + (i % 4) * 50000, status: ['pending', 'completed', 'failed'][i % 3], payment_method: 'demo_only',
      transaction_code: 'GS-DEMO-V1-' + String(i + 1).padStart(3, '0'), created_at: at(-12 + i),
    });
    for (let i = 0; i < 12; i++) {
      const status = ['completed', 'completed_with_errors', 'failed', 'running'][i % 4];
      await insert(client, 'scholarship_crawl_logs', { source_name: '[DEMO] Global Success Fixtures', source_url: PREFIX + '/crawler/' + (i + 1),
        started_at: at(-i), finished_at: status === 'running' ? null : at(-i, 5),
        found_count: status === 'failed' || status === 'running' ? 0 : 10,
        saved_count: status === 'completed' ? 10 : status === 'completed_with_errors' ? 8 : 0,
        failed_count: status === 'completed_with_errors' ? 2 : 0,
        status, error_message: status === 'failed' ? '[DEMO] Nguồn thử nghiệm không phản hồi.' : null });
    }
    for (let day = 0; day < 30; day++) {
      for (let i = 0; i < 5 + day % 8; i++) await insert(client, 'app_events', {
        event_name: ['app_open', 'scholarship_view', 'scholarship_search', 'scholarship_save'][i % 4],
        user_id: students[(day + i) % 40].id, session_id: randomUUID(),
        scholarship_id: i % 4 === 1 || i % 4 === 3 ? published[(day + i) % published.length].id : null,
        properties: JSON.stringify({ demo: true, platform: 'android', dataset: 'global-success-v1' }),
        occurred_at: at(-day, i), received_at: at(-day, i),
      });
    }
    const after = await counts(client);
    const created = Object.fromEntries(TABLES.map(table => [table, after[table] - before[table]]));
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    committed = apply;
    return { alreadySeeded: false, applied: apply, created, adminEmail: ADMIN, scholarshipId: published[0].id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (!committed) for (const file of files) await fs.unlink(file).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--dry-run', '--allow-current-db'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) throw new Error('Dùng --dry-run hoặc --apply, kèm --allow-current-db nếu nạp vào database hiện tại.');
  validateTarget(process.env, args);
  const { Client } = require('pg');
  const client = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  try {
    await client.connect();
    const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (actual !== process.env.DB_NAME) throw new Error('Database thực tế không khớp DB_NAME.');
    console.log('Database đích: ' + actual + '. Chế độ: ' + (args.includes('--apply') ? 'lưu dataset' : 'dry run (rollback)') + '.');
    const result = await seedDemo(client, { password: process.env.DEMO_PASSWORD, apply: args.includes('--apply'), baseDate: process.env.DEMO_DATE || new Date() });
    console.log(JSON.stringify(result, null, 2));
    console.log(result.alreadySeeded ? 'Dataset đã có; giữ nguyên dữ liệu, không tạo bản trùng.' : result.applied ? 'Đã nạp dataset Global Success.' : 'Dry run đạt: dữ liệu và tệp vừa tạo đã được hoàn tác. Thêm --apply để lưu.');
    console.log('Mật khẩu lấy từ DEMO_PASSWORD, không được in ra. Tài khoản .invalid không dùng để thử gửi email thật.');
  } finally { await client.end().catch(() => {}); }
}

if (require.main === module) main().catch(error => {
  console.error('Không thể seed: ' + (error.code ? 'DB error ' + error.code : error.message));
  process.exitCode = 1;
});
module.exports = { seedDemo, validateTarget, demoPdf };
