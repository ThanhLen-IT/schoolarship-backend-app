const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');

const uploadDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Evidence is stored outside the public static routes. Never expose uploads/ with express.static.
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const nonce = randomBytes(8).toString('hex');
        cb(null, `evidence-${req.user.id}-${Date.now()}-${nonce}.pdf`);
    }
});
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    return cb(new Error('Chỉ chấp nhận file PDF!'), false);
};

const uploadEvidence = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter
});

module.exports = { uploadEvidence, uploadDir };
