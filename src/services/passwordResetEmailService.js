const axios = require("axios");
const nodemailer = require("nodemailer");
const { passwordResetEmailTemplate } = require("../utils/passwordResetEmailTemplate");

function emailConfiguration() {
  // Preserve existing Resend installations unless SMTP is explicitly selected.
  const provider = (process.env.PASSWORD_RESET_PROVIDER || "resend").trim().toLowerCase();
  const from = process.env.PASSWORD_RESET_FROM?.trim();
  let resetUrl;
  try {
    resetUrl = new URL(process.env.PASSWORD_RESET_URL);
    if (!["http:", "https:", "scholarship:"].includes(resetUrl.protocol)) return null;
  } catch (_) {
    return null;
  }
  if (!from) return null;

  if (provider === "resend" && process.env.RESEND_API_KEY?.trim()) {
    return { provider, from, resetUrl };
  }
  if (provider !== "smtp") return null;

  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const port = Number(process.env.SMTP_PORT || "465");
  const pass = host?.toLowerCase() === "smtp.gmail.com"
    ? process.env.SMTP_PASS?.replace(/\s+/g, "")
    : process.env.SMTP_PASS;
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { provider, from, resetUrl, host, port, user, pass };
}

function isPasswordResetEmailConfigured() {
  return emailConfiguration() !== null;
}

function smtpTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    dnsTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

// Checks DNS/TCP/TLS/authentication only; never sends a message or creates a token.
async function verifyPasswordResetSmtp() {
  const config = emailConfiguration();
  if (!config || config.provider !== "smtp") {
    const error = new Error("SMTP configuration is incomplete");
    error.code = "EMAIL_CONFIG";
    throw error;
  }
  return smtpTransport(config).verify();
}

async function sendPasswordResetEmail(email, token) {
  const config = emailConfiguration();
  if (!config) {
    throw new Error("Password reset email service is not configured");
  }

  const { resetUrl } = config;
  resetUrl.searchParams.set("token", token);
  const message = {
    from: config.from,
    to: [email],
    ...passwordResetEmailTemplate(resetUrl.toString()),
  };

  if (config.provider === "smtp") {
    // Never fall back to another provider after an ambiguous delivery failure.
    return smtpTransport(config).sendMail(message);
  }

  await axios.post(
    "https://api.resend.com/emails",
    message,
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
  verifyPasswordResetSmtp,
};
