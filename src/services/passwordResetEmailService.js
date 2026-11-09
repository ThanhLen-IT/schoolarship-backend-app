const axios = require("axios");

function isPasswordResetEmailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.PASSWORD_RESET_FROM &&
    process.env.PASSWORD_RESET_URL
  );
}

async function sendPasswordResetEmail(email, token) {
  if (!isPasswordResetEmailConfigured()) {
    throw new Error("Password reset email service is not configured");
  }

  const resetUrl = new URL(process.env.PASSWORD_RESET_URL);
  resetUrl.searchParams.set("token", token);

  await axios.post(
    "https://api.resend.com/emails",
    {
      from: process.env.PASSWORD_RESET_FROM,
      to: [email],
      subject: "Dat lai mat khau Scholarship Gateway",
      text:
        "Ban da yeu cau dat lai mat khau. Mo lien ket sau trong 15 phut:\n" +
        resetUrl.toString() +
        "\n\nNeu ban khong yeu cau, vui long bo qua email nay.",
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    },
  );
}

module.exports = {
  isPasswordResetEmailConfigured,
  sendPasswordResetEmail,
};
