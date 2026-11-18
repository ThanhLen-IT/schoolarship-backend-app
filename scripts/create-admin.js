require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');

function adminFields(env) {
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const fullName = (env.ADMIN_NAME || 'Global Success Admin').trim();
  const password = env.ADMIN_PASSWORD || '';
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL không hợp lệ.');
  if (!fullName || fullName.length > 100) throw new Error('ADMIN_NAME phải có từ 1 đến 100 ký tự.');
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < 12 || bytes > 72) throw new Error('Đặt ADMIN_PASSWORD từ 12 đến 72 byte UTF-8.');
  return { email, fullName, password };
}

async function createAdmin(client, fields) {
  const existing = await client.query('SELECT id, email, role, is_active FROM users WHERE lower(email)=$1', [fields.email]);
  if (existing.rows.length) {
    const user = existing.rows[0];
    if (existing.rows.length !== 1 || user.role !== 'admin' || !user.is_active) {
      throw new Error('Email đã thuộc tài khoản khác hoặc bị vô hiệu hóa. Chọn email mới; script không đổi quyền hay mật khẩu tài khoản cũ.');
    }
    return { created: false, user };
  }
  const hash = await bcrypt.hash(fields.password, 12);
  const result = await client.query(
    `INSERT INTO users(email, password_hash, full_name, role, is_active, is_mentor)
     VALUES($1, $2, $3, 'admin', true, false) RETURNING id, email, role, is_active`,
    [fields.email, hash, fields.fullName],
  );
  return { created: true, user: result.rows[0] };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Nhập ADMIN_EMAIL và ADMIN_PASSWORD qua biến môi trường, không qua tham số lệnh.');
  const fields = adminFields(process.env);
  if (!process.env.DB_NAME) throw new Error('Thiếu DB_NAME trong cấu hình.');
  const { Client } = require('pg');
  const client = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  try {
    await client.connect();
    const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (actual !== process.env.DB_NAME) throw new Error('Database thực tế không khớp DB_NAME.');
    console.log('Database đích: ' + actual);
    const result = await createAdmin(client, fields);
    console.log(result.created ? 'Đã tạo admin: ' + result.user.email : 'Admin đã tồn tại; giữ nguyên mật khẩu: ' + result.user.email);
  } finally { await client.end().catch(() => {}); }
}

if (require.main === module) main().catch(error => {
  console.error('Không thể tạo admin: ' + (error.code ? 'DB error ' + error.code : error.message));
  process.exitCode = 1;
});
module.exports = { adminFields, createAdmin };
