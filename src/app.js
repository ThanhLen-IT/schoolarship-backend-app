const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Khởi chạy kết nối Database
require("./config/db");

const app = express();

// Middlewares
// Register before CORS/body parsers so preflight and malformed JSON are logged.
const { createRequestLogger } = require('./middlewares/requestLogger');
const { errorHandler } = require('./middlewares/errorHandler');
app.use(createRequestLogger());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Khai báo Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const scholarshipRoutes = require("./routes/scholarshipRoutes");
const adminCrawlerRoutes = require("./routes/adminCrawlerRoutes");
const adminScholarshipRoutes = require("./routes/adminScholarshipRoutes");
const mentorRoutes = require("./routes/mentorRoutes");
const adminMentorRoutes = require("./routes/adminMentorRoutes");
const postRoutes = require("./routes/postRoutes");
const mentoringRoutes = require("./routes/mentoringRoutes");
const adminMentoringRoutes = require("./routes/adminMentoringRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/scholarships", scholarshipRoutes);
app.use("/api/admin/crawler", adminCrawlerRoutes);
app.use("/api/admin/scholarships", adminScholarshipRoutes);
app.use("/api/mentors", mentorRoutes);
app.use("/api/admin/mentors", adminMentorRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/mentoring", mentoringRoutes);
app.use("/api/admin/mentoring", adminMentoringRoutes);

// Liveness: confirms the Express process is running.
app.get('/health', (req, res) => {
    return res.status(200).json({ success: true, status: 'up' });
});

// Readiness: reports whether PostgreSQL is reachable before the demo.
app.get('/health/ready', async (req, res) => {
    try {
        await require('./config/db').query('SELECT 1');
        return res.status(200).json({ success: true, status: 'ready' });
    } catch (error) {
        req.logError?.(error);
        return res.status(503).json({ success: false, status: 'database_unavailable' });
    }
});

// Midterm readiness also checks that the additive Ranking migration is installed.
app.get('/health/midterm', async (req, res) => {
    try {
        const pool = require('./config/db');
        await pool.query('SELECT mentoring_started_at, scholarship_outcome FROM mentee_applications LIMIT 0');
        await pool.query('SELECT id FROM mentoring_response_requests LIMIT 0');
        return res.status(200).json({ success: true, status: 'midterm_ready' });
    } catch (error) {
        req.logError?.(error);
        return res.status(503).json({ success: false, status: 'midterm_schema_unavailable' });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'Scholarship Gateway API is running smoothly!',
        status: 'Healthy',
        version: '1.2.0',
        database: process.env.DB_NAME
    });
});

// Middleware xử lý lỗi tập trung
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});
