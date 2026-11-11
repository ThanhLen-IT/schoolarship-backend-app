// Body-parser errors can contain the original JSON (including credentials).
// Log only the safe error category/code and return a generic client message.
function errorHandler(err, req, res, next) {
  req.logError?.(err);
  // The default Express handler would print err.stack after headers were sent.
  // Close the incomplete response without forwarding the sensitive error.
  if (res.headersSent) return res.destroy();
  const errorStatus = err.status || err.statusCode;
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413
    : Number.isInteger(errorStatus) && errorStatus >= 400 && errorStatus <= 599 ? errorStatus : 500;
  return res.status(status).json({
    success: false,
    message: status === 413 ? 'Dữ liệu hoặc tệp tải lên quá lớn.'
      : status >= 500 ? 'Lỗi máy chủ nội bộ!' : 'Yêu cầu không hợp lệ.'
  });
}

module.exports = { errorHandler };
