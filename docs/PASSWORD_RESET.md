# Password reset integration

## Global Success email
Password-reset messages use the official Global Success name, a Vietnamese HTML
layout with a reset button, and a plain-text alternative. Both versions explain
the 15-minute expiry, single-use link, and how to paste the link into the Android
app when an email client does not open it. No external images or tracking assets
are included in the template.

For the current Android app, use `PASSWORD_RESET_URL=scholarship://reset-password`.
After editing `.env`, restart `scholarship-api.service`; request a new email to
see the new template. Set the sender display name to Global Success, for example
`PASSWORD_RESET_FROM="Global Success <onboarding@resend.dev>"` for Resend testing.
The testing sender only delivers to the Resend account's own email. For other
recipients, configure a verified sending domain and use its address instead.
The template does not change these provider restrictions.

## Security fix
Previously `POST /api/auth/forgot-password` accepted `{ "email", "new_password" }` and
changed the password without verifying ownership. **That interface is unsafe and has been replaced.**

## Configure email
Choose a provider explicitly in your private `.env`. Existing deployments with
no `PASSWORD_RESET_PROVIDER` continue using Resend. Invalid/incomplete settings
return HTTP 503. There is **no token in an API response or server log**.

### Gmail SMTP (no custom domain required)
1. Sign in to the dedicated Gmail sender account.
2. Enable 2-Step Verification, then create an App Password named Global Success:
   https://myaccount.google.com/apppasswords . Availability depends on account policy.
3. Edit `.env` on EC2 (never commit it or paste the password into a chat):

```dotenv
PASSWORD_RESET_PROVIDER=smtp
PASSWORD_RESET_FROM="Global Success <your-sender@gmail.com>"
PASSWORD_RESET_URL=scholarship://reset-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-sender@gmail.com
SMTP_PASS=replace_with_the_app_password
```

Use the actual Gmail address in both SMTP_USER and PASSWORD_RESET_FROM. SMTP_PASS
must be the App Password of this sender account, not the normal login password.
For Gmail only, spaces in the copied App Password are removed automatically.
The recipient remains the email of the account requesting the reset, even when
it differs from SMTP_USER. Provider sending limits and delivery policies apply.
Existing Resend variables may remain; they are ignored when smtp is selected.

4. On the current `feat/mobile-completion` branch, deploy the code and dependency:

```bash
cd ~/apps/schoolarship-backend-app
git pull --ff-only origin feat/mobile-completion && npm ci --omit=dev
npm run check:email
# Restart after the diagnostic succeeds:
sudo systemctl restart scholarship-api.service
```

The diagnostic checks DNS, TCP, TLS and login without sending a message or
creating a reset token. A pass does not establish delivery to an inbox. Request
a reset for an existing app account with a different email and check its inbox.
No production account credentials or Gmail delivery were tested in development.
Development verification used the real Nodemailer SMTP client against a local
SMTP fixture with STARTTLS and a certificate trusted only by the test process.
It confirmed delivery to a different test address, UTF-8 HTML/plain-text MIME,
intact links, no message during verify, and rejection of authentication with 535.

Port 465 uses implicit TLS; port 587 requires STARTTLS. Certificate verification
stays enabled. EC2 needs outbound access to the configured SMTP host/port.
SMTP errors in the service journal expose only an allowlisted error code and
numeric `smtp_status`, never the raw response, credentials or email content.
For example, `EAUTH`/535 indicates failed authentication. Run `check:email` from
the same directory and environment as the service if systemd overrides `.env`.

### Resend
Set `PASSWORD_RESET_PROVIDER=resend`, `RESEND_API_KEY`, `PASSWORD_RESET_FROM`
and `PASSWORD_RESET_URL`. Use a verified sending domain for real user recipients.
The existing Axios/Resend REST API integration remains available. No automatic
provider fallback is performed after a delivery error.

References:
- https://support.google.com/accounts/answer/185833
- https://developers.google.com/workspace/gmail/imap/imap-smtp
- https://nodemailer.com/smtp

## New API contract
**Request a password reset**
```http
POST /api/auth/forgot-password
Content-Type: application/json

{ "email": "student@example.com" }
```
Returns HTTP 200 and the same generic message for existing and unknown emails.
A token is generated only for active accounts and emailed to the owner.
A repeat request while an existing token has more than 14 minutes remaining (approximately the first minute after issue) does not send another email.

**Confirm a password reset**
```http
POST /api/auth/reset-password
Content-Type: application/json

{ "token": "64_lowercase_hex_characters_from_email", "new_password": "NewStrongPassword123" }
```
Valid tokens expire in 15 minutes, are stored as SHA-256 digests in the existing
`users.reset_password_token` field and are cleared atomically on successful reset.
The new password must be 8-72 UTF-8 bytes.

## Follow-up requirements
- Verify link opening in the target email clients and the current Android build.
- Configure and verify a working mail sender before using this endpoint.
- Add IP-based rate limiting and consider JWT revocation upon password change
  before production launch.
- Do not store or log reset tokens in Analytics or application logs.
