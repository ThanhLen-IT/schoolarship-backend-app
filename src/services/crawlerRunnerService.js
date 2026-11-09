
const { randomUUID } = require('crypto');

const crawlConfigs = require('../config/crawlerConfig');
const { crawlScholarships } = require('./crawlerService');

const delay = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

// Lưu trạng thái lần chạy crawler hiện tại
let currentRun = null;

// ==================================================
// 1. LẤY DANH SÁCH NGUỒN CRAWLER
// ==================================================

function getCrawlerSources() {
    return crawlConfigs.map((config) => ({
        key: config.key,
        sourceName: config.sourceName,
        sourceUrl: config.sourceUrl,
        enabled: config.enabled !== false,
        defaults: config.defaults,
        maxItems: config.maxItems ?? null
    }));
}

// ==================================================
// 2. LẤY TRẠNG THÁI CRAWLER
// ==================================================

function getCurrentRun() {
    if (!currentRun) {
        return null;
    }

    return {
        ...currentRun,
        results: [...currentRun.results]
    };
}

// ==================================================
// 3. KHỞI CHẠY CRAWLER
// ==================================================

function startCrawler(sourceKey = 'all') {

    // Không cho chạy nhiều lượt cùng lúc
    if (currentRun?.status === 'running') {
        const error = new Error(
            'Crawler đang chạy. Vui lòng đợi hoàn thành.'
        );

        error.statusCode = 409;
        throw error;
    }

    // Xác định các nguồn cần chạy
    const targets = sourceKey === 'all'
        ? crawlConfigs.filter(
            (config) => config.enabled !== false
        )
        : crawlConfigs.filter(
            (config) =>
                config.key === sourceKey &&
                config.enabled !== false
        );

    // Không tìm thấy nguồn phù hợp
    if (targets.length === 0) {
        const error = new Error(
            `Không tìm thấy nguồn crawler "${sourceKey}".`
        );

        error.statusCode = 400;
        throw error;
    }

    // Tạo thông tin lượt chạy
    const run = {
        runId: randomUUID(),
        sourceKey,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        results: [],
        error: null
    };

    currentRun = run;

    // Chạy crawler nền
    (async () => {
        try {
            for (let i = 0; i < targets.length; i++) {

                console.log(
                    `\n🚀 Bắt đầu nguồn: ${targets[i].sourceName}`
                );

                const result = await crawlScholarships(
                    targets[i]
                );

                run.results.push(result);

                // Nghỉ 3 giây giữa các nguồn
                if (i < targets.length - 1) {
                    await delay(3000);
                }
            }

            // Kiểm tra kết quả
            const hasFailed = run.results.some(
                (result) =>
                    result.status === 'failed' ||
                    result.failed > 0
            );

            run.status = hasFailed
                ? 'completed_with_errors'
                : 'completed';

        } catch (error) {
            console.error(
                'Lỗi trong quá trình chạy crawler:',
                error.message
            );

            run.status = 'failed';
            run.error = error.message;

        } finally {
            run.finishedAt = new Date().toISOString();

            console.log('\n========== CRAWLER FINISHED ==========');
            console.log('Run ID:', run.runId);
            console.log('Status:', run.status);
            console.log('Results:', run.results);
        }
    })();

    return getCurrentRun();
}

// ==================================================
// EXPORT
// ==================================================

module.exports = {
    getCrawlerSources,
    getCurrentRun,
    startCrawler
};
