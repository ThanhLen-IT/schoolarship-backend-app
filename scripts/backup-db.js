require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

async function main() {
  if (!process.env.DB_NAME) throw new Error('Thiếu DB_NAME trong cấu hình.');
  const directory = path.join(os.homedir(), 'backups', 'global-success');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.dump');
  const file = await fs.open(filename, 'wx', 0o600);
  try {
    const args = ['--format=custom', '--no-password', '--dbname', process.env.DB_NAME];
    for (const [option, value] of [['--host', process.env.DB_HOST], ['--port', process.env.DB_PORT], ['--username', process.env.DB_USER]]) {
      if (value) args.push(option, value);
    }
    await new Promise((resolve, reject) => {
      const child = spawn('pg_dump', args, {
        env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' },
        stdio: ['ignore', file.fd, 'ignore'],
      });
      child.once('error', () => reject(new Error('Không chạy được pg_dump. Kiểm tra PostgreSQL client đã được cài.')));
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('pg_dump thất bại. Kiểm tra kết nối, quyền DB user và phiên bản PostgreSQL client.')));
    });
    if (!(await file.stat()).size) throw new Error('Bản sao lưu rỗng.');
  } catch (error) {
    await fs.unlink(filename).catch(() => {});
    throw error;
  } finally { await file.close(); }
  console.log('Đã sao lưu database ' + process.env.DB_NAME + ': ' + filename);
  console.log('Bản sao lưu này chứa database; giữ riêng thư mục uploads và media nếu cần khôi phục cả tệp.');
}

main().catch(error => { console.error('Không thể sao lưu: ' + error.message); process.exitCode = 1; });
