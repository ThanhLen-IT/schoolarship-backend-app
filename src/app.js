const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Khởi chạy kết nối Database
require('./config/db');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint kiểm tra hoạt động của Server
app.get('/', (req, res) => {
    res.json({
        message: 'Scholarship Gateway API is running!',
        status: 'Healthy',
        database: process.env.DB_NAME
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});