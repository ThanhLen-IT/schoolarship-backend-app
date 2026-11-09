# Password reset integration

## Security fix
Previously `POST /api/auth/forgot-password` accepted `{ "email", "new_password" }` and
changed the password without verifying ownership. **That interface is unsafe and has been replaced.**

## Configure email
Add the following variables to your private `.env`:
- `RESEND_API_KEY`: Resend API key.
- `PASSWORD_RESET_FROM`: sender email verified in Resend.
- `PASSWORD_RESET_URL`: public web page / app deep link that accepts `token` query parameter.

The API uses the existing `axios` dependency to call the Resend REST API.
Without these settings the forgot-password endpoint returns HTTP 503 rather than issuing
an insecure reset token. There is **no token in an API response or server log**.

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
- Update the Mobile App / Web Admin reset-password screen for this two-step flow.
- Configure and verify a working mail sender before using this endpoint.
- Add IP-based rate limiting and consider JWT revocation upon password change
  before production launch.
- Do not store or log reset tokens in Analytics or application logs.
