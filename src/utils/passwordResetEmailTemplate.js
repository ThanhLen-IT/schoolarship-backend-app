function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function passwordResetEmailTemplate(resetLink) {
  const link = escapeHtml(resetLink);
  return {
    subject: 'Đặt lại mật khẩu tài khoản Global Success',
    text: `GLOBAL SUCCESS

Đặt lại mật khẩu

Xin chào,

Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Global Success của bạn.
Mở liên kết dưới đây để tạo mật khẩu mới:

${resetLink}

Liên kết có hiệu lực trong 15 phút và chỉ sử dụng được một lần.
Nếu liên kết không mở được, hãy sao chép toàn bộ liên kết và dán vào ô token/liên kết trên màn hình đặt lại mật khẩu trong ứng dụng Global Success.

Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.
Để bảo vệ tài khoản, không chia sẻ liên kết này với bất kỳ ai.

Đội ngũ Global Success
Email được gửi tự động, vui lòng không trả lời.`,
    html: `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Đặt lại mật khẩu | Global Success</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;color:#172033;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Khôi phục quyền truy cập Global Success. Liên kết có hiệu lực trong 15 phút.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
        <tr><td style="padding:28px 28px;background-color:#17144b;border-radius:16px 16px 0 0;">
          <p style="margin:0;color:#ffffff;font-size:23px;font-weight:700;letter-spacing:0.3px;">Global Success</p>
          <p style="margin:8px 0 0;color:#d7d8ef;font-size:13px;line-height:20px;">Bảo mật tài khoản</p>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 24px;color:#17144b;font-size:26px;line-height:34px;">Đặt lại mật khẩu</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:25px;">Xin chào,</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:25px;">Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản <strong>Global Success</strong> của bạn. Nhấn nút bên dưới để tạo mật khẩu mới.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#3830a3" style="border-radius:8px;">
            <a href="${link}" style="display:inline-block;padding:16px 28px;border:1px solid #3830a3;border-radius:8px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Đặt lại mật khẩu</a>
          </td></tr></table>
          <p style="margin:20px 0 24px;color:#475569;font-size:14px;line-height:23px;">Liên kết có hiệu lực trong <strong>15 phút</strong> và chỉ sử dụng được <strong>một lần</strong>.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;"><tr><td style="padding:16px;">
            <p style="margin:0 0 10px;font-size:13px;line-height:22px;color:#475569;">Nếu nút không hoạt động, sao chép toàn bộ liên kết dưới đây và dán vào ô <strong>token/liên kết</strong> trên màn hình đặt lại mật khẩu trong ứng dụng Global Success:</p>
            <p style="margin:0;font-size:12px;line-height:21px;word-break:break-all;overflow-wrap:anywhere;"><a href="${link}" style="color:#3830a3;text-decoration:underline;word-break:break-all;">${link}</a></p>
          </td></tr></table>
          <p style="margin:24px 0 12px;font-size:14px;line-height:24px;color:#475569;"><strong>Bạn không gửi yêu cầu này?</strong><br>Hãy bỏ qua email. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.</p>
          <p style="margin:0;font-size:14px;line-height:24px;color:#475569;">Để bảo vệ tài khoản, không chia sẻ liên kết này với bất kỳ ai.</p>
          <p style="margin:28px 0 0;font-size:14px;line-height:24px;">Trân trọng,<br><strong>Đội ngũ Global Success</strong></p>
        </td></tr>
        <tr><td style="padding:20px 28px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#64748b;font-size:12px;line-height:20px;">Email được gửi tự động từ Global Success. Vui lòng không trả lời email này.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  };
}

module.exports = { passwordResetEmailTemplate };
