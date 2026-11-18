require("dotenv").config({ quiet: true });
const { verifyPasswordResetSmtp } = require("../src/services/passwordResetEmailService");

verifyPasswordResetSmtp().then(() => {
  console.log("SMTP: kết nối TLS và xác thực thành công. Chưa gửi email; hãy thử Quên mật khẩu trên app để kiểm tra nhận thư.");
}).catch(error => {
  const hints = {
    EMAIL_CONFIG: "Kiểm tra PASSWORD_RESET_PROVIDER=smtp, PASSWORD_RESET_FROM, PASSWORD_RESET_URL, SMTP_HOST, SMTP_PORT, SMTP_USER và SMTP_PASS.",
    EAUTH: "Xác thực thất bại. Với Gmail, dùng Mật khẩu ứng dụng của đúng tài khoản SMTP_USER, không dùng mật khẩu đăng nhập Gmail.",
    ETIMEDOUT: "Kết nối hết thời gian. Kiểm tra EC2 có kết nối ra SMTP_HOST trên cổng SMTP_PORT.",
    ECONNECTION: "Không kết nối được máy chủ SMTP. Kiểm tra host, port và kết nối mạng.",
    ECONNREFUSED: "Máy chủ SMTP từ chối kết nối. Kiểm tra host và port.",
    ESOCKET: "Lỗi kết nối hoặc TLS. Kiểm tra mạng, host và chứng chỉ máy chủ.",
    ETLS: "Không thiết lập được kết nối TLS an toàn.",
    EDNS: "Không phân giải được địa chỉ máy chủ SMTP.",
  };
  // Raw Nodemailer errors can contain account addresses and server responses.
  console.error("SMTP: " + (hints[error.code] || "Kiểm tra cấu hình SMTP và kết nối mạng."));
  if (Number.isInteger(error.responseCode)) console.error("SMTP status: " + error.responseCode);
  process.exitCode = 1;
});
