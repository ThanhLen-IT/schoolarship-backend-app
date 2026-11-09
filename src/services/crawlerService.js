// src/services/crawlerService.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const pool = require("../config/db");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HEADLESS = process.env.HEADLESS === "true";
const DEBUG = process.env.DEBUG_CRAWL === "true";

/* ──────────────────────────────────────────────
   1. Kiểm tra config trước khi mở trình duyệt
   ────────────────────────────────────────────── */
function validateConfig(config) {
  for (const field of ["key", "sourceName", "sourceUrl", "baseUrl"]) {
    if (!config[field]) throw new Error(`Config thiếu trường "${field}"`);
  }
  const sel = config.selectors || {};
  if (!sel.item || !sel.link) {
    throw new Error(
      `Config "${config.key}" thiếu selectors.item hoặc selectors.link`,
    );
  }
}

/* ──────────────────────────────────────────────
   2. Thực thi các bước thao tác khai báo trong config
   ────────────────────────────────────────────── */
async function runSteps(page, steps = []) {
  for (const step of steps) {
    if (step.label) console.log(`👉 ${step.label}`);

    switch (step.type) {
      case "click":
        await page.waitForSelector(step.selector, {
          visible: true,
          timeout: 15000,
        });
        await page.click(step.selector);
        break;
      case "clickHidden":
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el && !el.checked) el.click();
        }, step.selector);
        break;
      case "waitForSelector":
        await page.waitForSelector(step.selector, {
          timeout: step.timeout || 15000,
        });
        break;
      case "wait":
        await delay(step.ms);
        break;
      default:
        throw new Error(`Loại step không hỗ trợ: "${step.type}"`);
    }
    if (step.waitAfter) await delay(step.waitAfter);
  }
}

/* ──────────────────────────────────────────────
   3. Bóc tách HTML danh sách
   ────────────────────────────────────────────── */
function toAbsoluteUrl(href, base) {
  if (!href || href.startsWith("#") || href.startsWith("javascript:"))
    return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

const clean = (text) => text.replace(/\s+/g, " ").trim();

function parseList(html, config, currentUrl) {
  const $ = cheerio.load(html);
  const { item, title, link, deadline } = config.selectors;
  const base = currentUrl || config.baseUrl;
  const rows = [];
  const rawUrls = [];

  const nodes = $(item);
  nodes.each((_, el) => {
    // --- 🟢 BẮT ĐẦU ĐOẠN CODE THÊM MỚI 🟢 ---
    // Lấy nhãn cộng đồng của bài viết
    const communityLabel = $(el)
      .find("a.community")
      .text()
      .trim()
      .toLowerCase();

    // Nếu nhãn KHÔNG PHẢI là "@học bổng" thì lập tức bỏ qua thẻ này
    // (Cách này an toàn tuyệt đối 100%, bỏ qua luôn cả banner quảng cáo và tin tuyển dụng)
    if (!communityLabel.includes("học bổng")) {
      return;
    }
    // --- 🟢 KẾT THÚC ĐOẠN CODE THÊM MỚI 🟢 ---

    const $link = $(el).is(link) ? $(el) : $(el).find(link).first();
    const detailUrl = toAbsoluteUrl($link.attr("href"), base);
    if (detailUrl) rawUrls.push(detailUrl);

    const rawTitle = title ? $(el).find(title).first().text() : $link.text();
    const baseTitle = clean(rawTitle);
    if (!baseTitle || !detailUrl) return;

    // Bóc tách thêm deadline từ ngoài danh sách YBOX
    let parsedDeadlineStr = null;
    if (deadline) {
      const rawDeadline = $(el).find(deadline).first().text();
      if (rawDeadline) {
        const dateParts = clean(rawDeadline).split("/");
        if (dateParts.length === 3) {
          parsedDeadlineStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        }
      }
    }

    rows.push({
      title: baseTitle.slice(0, 255),
      detailUrl,
      deadline: parsedDeadlineStr,
    });
  });

  return { rows, rawUrls, totalNodes: nodes.length };
}

/* ──────────────────────────────────────────────
   4. Thu thập danh sách
   ────────────────────────────────────────────── */
async function collectItems(page, config) {
  const maxItems = config.maxItems ?? Infinity;
  const seen = new Map();

  // Đơn giản hoá: YBOX ko có next button rõ ràng ở frontend, ta tạm lấy trang hiện tại
  const html = await page.content();
  const { rows, rawUrls, totalNodes } = parseList(html, config, page.url());
  console.log(
    `🔎 Tìm thấy: ${totalNodes} thẻ [${config.selectors.item}], giữ lại ${rows.length}.`,
  );

  for (const row of rows) {
    if (!seen.has(row.detailUrl)) seen.set(row.detailUrl, row);
  }

  return [...seen.values()].slice(0, maxItems);
}

/* ──────────────────────────────────────────────
   5. Truy cập chi tiết & Bóc tách nội dung HTML
   ────────────────────────────────────────────── */
async function getDetailHtml(page, detailUrl, selector) {
  try {
    console.log(`  ➡️ Đang tải chi tiết: ${detailUrl}`);
    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Trích xuất thẻ nội dung (Vd: .content-wrapper)
    const htmlContent = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      return element ? element.outerHTML : "";
    }, selector);

    return htmlContent;
  } catch (e) {
    console.error(`  ❌ Lỗi tải chi tiết ${detailUrl}:`, e.message);
    return null;
  }
}

/* ──────────────────────────────────────────────
   6. Hàm chính
   ────────────────────────────────────────────── */
async function crawlScholarships(config) {
  validateConfig(config);

  const logInsert = await pool.query(
    `INSERT INTO scholarship_crawl_logs (source_name, source_url, status)
         VALUES ($1, $2, 'running') RETURNING id`,
    [config.sourceName, config.sourceUrl],
  );
  const logId = logInsert.rows[0].id;

  let found = 0,
    saved = 0,
    failed = 0;
  let browser = null;

  try {
    console.log(`\n🚀 [${config.key}] Mở ${config.sourceName}...`);
    browser = await puppeteer.launch({
      headless: HEADLESS,
      defaultViewport: null,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
    });

    // 1. Quét danh sách
    const page = await browser.newPage();
    await page.goto(config.sourceUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await delay(config.initialWait ?? 3000);

    await runSteps(page, config.steps);

    const items = await collectItems(page, config);
    found = items.length;

    // 2. Chui vào từng link lấy HTML Detail
    if (config.selectors.detailContent) {
      for (let i = 0; i < items.length; i++) {
        const detailHtml = await getDetailHtml(
          page,
          items[i].detailUrl,
          config.selectors.detailContent,
        );
        items[i].html = detailHtml;
        await delay(1500); // Tránh rate-limit
      }
    }

    await browser.close();
    browser = null;

    // 3. Ghi vào database với các cột type ARRAY và HTML
    const d = config.defaults || {};
    // Ép kiểu mảng cho study_levels, cú pháp postgres là mảng text
    const studyLevelsArr = d.study_level ? [d.study_level] : ["unknown"];

    for (const item of items) {
      try {
        const result = await pool.query(
          `INSERT INTO scholarships (
                        title, source_url, country, continent, status, source_name, deadline,
                        study_levels, original_content_html, content_html
                     )
                     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)
                     ON CONFLICT (source_url) DO NOTHING
                     RETURNING id`,
          [
            item.title,
            item.detailUrl,
            d.country ?? null,
            d.continent ?? null,
            config.sourceName,
            item.deadline ?? null, // Lưu ngày
            studyLevelsArr, // Array kiểu text[][cite: 7]
            item.html ?? null, // Lưu chuỗi HTML gốc[cite: 7]
            item.html ?? null, // Cùng lưu HTML hiển thị (Sau này Frontend tự bọc style hoặc admin CMS sửa lại)[cite: 7]
          ],
        );
        if (result.rowCount > 0) saved++;
      } catch (err) {
        failed++;
        console.error(`❌ Lỗi lưu "${item.title}":`, err.message);
      }
    }

    await pool.query(
      `UPDATE scholarship_crawl_logs
             SET finished_at = CURRENT_TIMESTAMP, found_count = $1, saved_count = $2,
                 failed_count = $3, status = 'completed'
             WHERE id = $4`,
      [found, saved, failed, logId],
    );

    console.log(
      `✅ [${config.key}] Xong! Bóc tách ${found} - lưu mới ${saved} - lỗi ${failed}.`,
    );
    return { key: config.key, status: "completed", found, saved, failed };
  } catch (error) {
    await pool.query(
      `UPDATE scholarship_crawl_logs
             SET finished_at = CURRENT_TIMESTAMP, found_count = $1, saved_count = $2,
                 failed_count = $3, status = 'failed', error_message = $4
             WHERE id = $5`,
      [found, saved, failed, error.message, logId],
    );
    console.error(`🔥 [${config.key}] LỖI:`, error.message);
    return {
      key: config.key,
      status: "failed",
      found,
      saved,
      failed,
      error: error.message,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  crawlScholarships,
  crawlBasicScholarships: crawlScholarships,
  pool,
};
