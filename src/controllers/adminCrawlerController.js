const pool = require("../config/db");
const { normalizeStudyLevels, isValidISODate, sanitizeScholarshipHtml } = require("../utils/scholarshipContent");
const { approvePendingScholarship } = require("../services/scholarshipApprovalService");

const {
  getCrawlerSources,
  getCurrentRun,
  startCrawler,
} = require("../services/crawlerRunnerService");

// ==================================================
// HÀM HỖ TRỢ
// ==================================================

// Kiểm tra ID hợp lệ
function parseId(value) {
  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Chuẩn hóa phân trang
function getPagination(query) {
  const pageValue = Number(query.page);
  const limitValue = Number(query.limit);

  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;

  const limit =
    Number.isInteger(limitValue) && limitValue > 0
      ? Math.min(limitValue, 100)
      : 20;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

// Xử lý trường hợp không tìm thấy học bổng
async function scholarshipNotFoundOrProcessed(id, res) {
  const check = await pool.query(
    `SELECT id, status
         FROM scholarships
         WHERE id = $1`,
    [id],
  );

  if (check.rowCount === 0) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy học bổng.",
    });
  }

  return res.status(409).json({
    success: false,
    message: `Học bổng đã được xử lý. Trạng thái hiện tại: ${check.rows[0].status}`,
  });
}

// ==================================================
// 1. LẤY DANH SÁCH NGUỒN CRAWLER
// GET /api/admin/crawler/sources
// ==================================================

exports.getSources = (req, res) => {
  try {
    const sources = getCrawlerSources();

    return res.status(200).json({
      success: true,
      data: sources,
    });
  } catch (error) {
    console.error("Lỗi getSources:", error.message);

    return res.status(500).json({
      success: false,
      message: "Không thể lấy danh sách nguồn crawler.",
    });
  }
};

// ==================================================
// 2. KHỞI CHẠY CRAWLER
// POST /api/admin/crawler/run
// Body: { "sourceKey": "korea" }
// Hoặc: { "sourceKey": "all" }
// ==================================================

exports.startCrawler = (req, res) => {
  try {
    const sourceKey =
      typeof req.body?.sourceKey === "string"
        ? req.body.sourceKey.trim()
        : "all";

    if (!sourceKey) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng chọn nguồn crawler.",
      });
    }

    const run = startCrawler(sourceKey);

    return res.status(202).json({
      success: true,
      message: "Crawler đã được khởi chạy.",
      data: run,
    });
  } catch (error) {
    console.error("Lỗi startCrawler:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Không thể khởi chạy crawler.",
    });
  }
};

// ==================================================
// 3. LẤY TRẠNG THÁI CRAWLER
// GET /api/admin/crawler/status
// ==================================================

exports.getStatus = (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: getCurrentRun(),
    });
  } catch (error) {
    console.error("Lỗi getStatus:", error.message);

    return res.status(500).json({
      success: false,
      message: "Không thể lấy trạng thái crawler.",
    });
  }
};

// ==================================================
// 4. LẤY LỊCH SỬ CRAWLER
// GET /api/admin/crawler/logs?page=1&limit=20
// Có thể lọc: source, status
// ==================================================

exports.getLogs = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    const conditions = [];
    const params = [];

    // Lọc theo tên nguồn
    if (req.query.source) {
      params.push(`%${String(req.query.source).trim()}%`);

      conditions.push(`source_name ILIKE $${params.length}`);
    }

    // Lọc theo trạng thái
    const allowedStatuses = ["running", "completed", "completed_with_errors", "failed"];

    if (req.query.status) {
      const status = String(req.query.status).trim();

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Trạng thái crawler không hợp lệ.",
        });
      }

      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Tổng số nhật ký
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
             FROM scholarship_crawl_logs
             ${whereClause}`,
      params,
    );

    // Lấy nhật ký theo trang
    const dataParams = [...params];

    dataParams.push(limit);
    const limitIndex = dataParams.length;

    dataParams.push(offset);
    const offsetIndex = dataParams.length;

    const result = await pool.query(
      `SELECT
                id,
                source_name,
                source_url,
                started_at,
                finished_at,
                found_count,
                saved_count,
                failed_count,
                status,
                error_message
             FROM scholarship_crawl_logs
             ${whereClause}
             ORDER BY started_at DESC
             LIMIT $${limitIndex}
             OFFSET $${offsetIndex}`,
      dataParams,
    );

    const total = countResult.rows[0].total;

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Lỗi getLogs:", error.message);

    return res.status(500).json({
      success: false,
      message: "Không thể lấy lịch sử crawler.",
    });
  }
};

// ==================================================
// 5. LẤY DANH SÁCH HỌC BỔNG CHỜ DUYỆT
// GET /api/admin/crawler/pending-scholarships
// ==================================================

exports.getPendingScholarships = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    const conditions = [`status = 'pending'`];
    const params = [];

    // Tìm kiếm theo tên hoặc tổ chức
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);

      conditions.push(
        `(title ILIKE $${params.length}
                  OR organization ILIKE $${params.length}
                  OR country ILIKE $${params.length})`,
      );
    }

    const whereClause = conditions.join(" AND ");

    // Đếm tổng học bổng chờ duyệt
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
             FROM scholarships
             WHERE ${whereClause}`,
      params,
    );

    // Lấy dữ liệu
    const dataParams = [...params];

    dataParams.push(limit);
    const limitIndex = dataParams.length;

    dataParams.push(offset);
    const offsetIndex = dataParams.length;

    const result = await pool.query(
      `SELECT
                id,
                title,
                organization,
                country,
                continent,
                type,
                deadline,
                description,
                requirements,
                benefits,
                application_link,
                image_url,
                source_url,
                crawled_at,
                created_at,
                status,
                majors,
                study_levels,
                content_html,
                original_content_html
             FROM scholarships
             WHERE ${whereClause}
             ORDER BY crawled_at DESC NULLS LAST,
                      created_at DESC
             LIMIT $${limitIndex}
             OFFSET $${offsetIndex}`,
      dataParams,
    );

    const total = countResult.rows[0].total;

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Lỗi getPendingScholarships:", error.message);

    return res.status(500).json({
      success: false,
      message: "Không thể lấy danh sách học bổng chờ duyệt.",
    });
  }
};

// ==================================================
// 6. CHỈNH SỬA THÔNG TIN HỌC BỔNG CHỜ DUYỆT
// PUT /api/admin/crawler/scholarships/:id
// ==================================================

exports.updateScholarship = async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID học bổng không hợp lệ.",
      });
    }

    // Chỉ cho phép cập nhật các trường dưới đây.
    // Không cho phép tự sửa status, reviewed_by hoặc source_url.
    const allowedFields = [
      "title",
      "organization",
      "country",
      "continent",
      "type",
      "deadline",
      "description",
      "requirements",
      "benefits",
      "application_link",
      "image_url",
      "majors",
      "study_levels",
      "content_html",
    ];

    const fields = allowedFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(req.body || {}, field),
    );

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Không có thông tin hợp lệ để cập nhật.",
      });
    }

    // Tên học bổng không được để trống
    if (fields.includes("title")) {
      if (typeof req.body.title !== "string" || !req.body.title.trim()) {
        return res.status(400).json({
          success: false,
          message: "Tên học bổng không được để trống.",
        });
      }
    }

    // Database đang dùng deadline DATE, định dạng YYYY-MM-DD
    if (fields.includes("deadline")) {
      const deadline = req.body.deadline;

      if (
        deadline !== null &&
        deadline !== "" &&
        !isValidISODate(deadline)
      ) {
        return res.status(400).json({
          success: false,
          message: "Hạn nộp phải có định dạng YYYY-MM-DD.",
        });
      }
    }

    if (fields.includes("majors")) {
      const majors = req.body.majors;

      if (
        majors !== null &&
        typeof majors !== "string" &&
        !Array.isArray(majors)
      ) {
        return res.status(400).json({
          success: false,
          message: "Danh sách ngành học không hợp lệ.",
        });
      }

      if (
        Array.isArray(majors) &&
        majors.some((item) => typeof item !== "string")
      ) {
        return res.status(400).json({
          success: false,
          message: "Tên ngành học phải là chuỗi ký tự.",
        });
      }
    }

    // Validation danh sách bậc học
    if (fields.includes("study_levels")) {
      const studyLevels = req.body.study_levels;

      if (
        studyLevels !== null &&
        typeof studyLevels !== "string" &&
        !Array.isArray(studyLevels)
      ) {
        return res.status(400).json({
          success: false,
          message: "Danh sách bậc học không hợp lệ.",
        });
      }

      if (
        Array.isArray(studyLevels) &&
        studyLevels.some((item) => typeof item !== "string")
      ) {
        return res.status(400).json({
          success: false,
          message: "Bậc học phải là chuỗi ký tự.",
        });
      }
    }

    // Database study_levels is NOT NULL and Mobile API uses canonical values.
    if (fields.includes("study_levels")) {
      try {
        normalizeStudyLevels(req.body.study_levels);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }

    // Never persist executable HTML in the editable mobile content field.
    if (fields.includes("content_html")) {
      if (req.body.content_html !== null &&
          (typeof req.body.content_html !== "string" || req.body.content_html.length > 2000000)) {
        return res.status(400).json({
          success: false, message: "content_html phải là HTML tối đa 2 triệu ký tự."
        });
      }
    }

    const values = fields.map((field) => {
      let value = req.body[field];

      // Xử lý danh sách ngành học
      if (field === "study_levels") {
        return normalizeStudyLevels(value);
      }
      if (field === "content_html") {
        return sanitizeScholarshipHtml(value);
      }
      if (field === "majors") {
        if (typeof value === "string") {
          value = value.split(/[,;\n]/);
        }

        if (value === null) {
          return null;
        }

        return [
          ...new Set(
            value
              .filter((item) => typeof item === "string")
              .map((item) => item.trim())
              .filter((item) => item.length > 0),
          ),
        ];
      }

      if (typeof value === "string") {
        value = value.trim();
      }

      if (field === "deadline" && value === "") {
        value = null;
      }

      return value;
    });

    const setClause = fields
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    values.push(id);

    const result = await pool.query(
      `UPDATE scholarships
             SET ${setClause}, updated_at = NOW()
             WHERE id = ${values.length}
               AND status = 'pending'
             RETURNING *`,
      values,
    );

    if (result.rowCount === 0) {
      return await scholarshipNotFoundOrProcessed(id, res);
    }

    return res.status(200).json({
      success: true,
      message: "Cập nhật học bổng thành công.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Lỗi updateScholarship:", error.message);

    if (error.code === "22008" || error.code === "22007") {
      return res.status(400).json({
        success: false,
        message: "Ngày tháng không hợp lệ.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Không thể cập nhật học bổng.",
    });
  }
};

// ==================================================
// 7. DUYỆT VÀ XUẤT BẢN HỌC BỔNG
// POST /api/admin/crawler/scholarships/:id/approve
// ==================================================

exports.approveScholarship = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const adminId = parseId(req.user?.id);
    if (!id) return res.status(400).json({ success: false, message: "ID học bổng không hợp lệ." });
    if (!adminId) return res.status(401).json({ success: false, message: "Không xác định được Admin." });

    const published = await approvePendingScholarship(id, adminId);
    if (!published) return await scholarshipNotFoundOrProcessed(id, res);

    return res.status(200).json({
      success: true,
      message: "Đã duyệt và xuất bản học bổng.",
      data: published,
    });
  } catch (error) {
    console.error("Lỗi approveScholarship:", error.message);
    return res.status(500).json({ success: false, message: "Không thể duyệt học bổng." });
  }
};

// ==================================================
// 8. TỪ CHỐI HỌC BỔNG
// POST /api/admin/crawler/scholarships/:id/reject
// Body: { "reason": "..." }
// ==================================================

exports.rejectScholarship = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const adminId = parseId(req.user?.id);
    const reason = String(req.body?.reason || "").trim();

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID học bổng không hợp lệ.",
      });
    }

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: "Không xác định được tài khoản Admin.",
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập lý do từ chối.",
      });
    }

    if (reason.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Lý do từ chối không được vượt quá 2000 ký tự.",
      });
    }

    const result = await pool.query(
      `UPDATE scholarships
             SET status = 'rejected',
                 reviewed_by = $2,
                 reviewed_at = NOW(),
                 rejection_reason = $3
             WHERE id = $1
               AND status = 'pending'
             RETURNING *`,
      [id, adminId, reason],
    );

    if (result.rowCount === 0) {
      return await scholarshipNotFoundOrProcessed(id, res);
    }

    return res.status(200).json({
      success: true,
      message: "Đã từ chối học bổng.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Lỗi rejectScholarship:", error.message);

    return res.status(500).json({
      success: false,
      message: "Không thể từ chối học bổng.",
    });
  }
};
