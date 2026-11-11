require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("node:fs/promises");
const path = require("node:path");
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
(async () => {
  try {
    await client.connect();
    for (const file of [
      "20261110_midterm_mentor_ranking.sql",
      "20261110_normalize_scholarship_study_levels.sql",
      "20261111_mobile_completion.sql",
    ]) {
      await client.query(
        await fs.readFile(path.join(__dirname, "../migrations", file), "utf8"),
      );
      console.log("Đã áp dụng: " + file);
    }
  } catch (error) {
    console.error(
      "Không thể cập nhật database. Kiểm tra kết nối, schema Database-v1.0 và quyền của DB user. Mã lỗi: " +
        (/^[A-Z0-9_]{1,20}$/.test(error.code || "") ? error.code : "UNKNOWN"),
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
