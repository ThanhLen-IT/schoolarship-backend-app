const axios = require("axios");
const { passwordResetEmailTemplate } = require("../utils/passwordResetEmailTemplate");

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
      ...passwordResetEmailTemplate(resetUrl.toString()),
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
