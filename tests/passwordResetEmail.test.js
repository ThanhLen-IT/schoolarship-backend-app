const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { passwordResetEmailTemplate } = require('../src/utils/passwordResetEmailTemplate');

const smtpEnv = {
  PASSWORD_RESET_PROVIDER: 'smtp',
  PASSWORD_RESET_FROM: 'Global Success <sender@example.test>',
  PASSWORD_RESET_URL: 'scholarship://reset-password',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'sender@example.test',
  SMTP_PASS: 'test app password only',
};

function load(env, { smtpError } = {}) {
  const calls = { http: [], options: [], messages: [], verify: 0 };
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/services/passwordResetEmailService.js'), 'utf8'), {
    module, exports: module.exports, process: { env }, URL,
    require(name) {
      if (name === 'axios') return { async post(...args) { calls.http.push(args); } };
      if (name === '../utils/passwordResetEmailTemplate') return { passwordResetEmailTemplate };
      if (name === 'nodemailer') return {
        createTransport(options) {
          calls.options.push(options);
          return {
            async verify() { calls.verify++; if (smtpError) throw smtpError; return true; },
            async sendMail(message) {
              if (smtpError) throw smtpError;
              calls.messages.push(message);
              return { accepted: message.to };
            },
          };
        },
      };
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return { service: module.exports, calls };
}

test('existing Resend configuration remains the default and preserves the reset token', async () => {
  const { service, calls } = load({
    RESEND_API_KEY: 'test-key', PASSWORD_RESET_FROM: smtpEnv.PASSWORD_RESET_FROM,
    PASSWORD_RESET_URL: 'https://example.test/reset?lang=vi',
  });
  assert.equal(service.isPasswordResetEmailConfigured(), true);
  const token = 'ab'.repeat(32);
  await service.sendPasswordResetEmail('recipient@example.test', token);
  assert.equal(calls.options.length, 0);
  assert.equal(calls.http.length, 1);
  const [, message] = calls.http[0];
  assert.equal(message.to[0], 'recipient@example.test');
  assert.ok(message.text.includes('https://example.test/reset?lang=vi&token=' + token));
  assert.ok(message.html.includes('lang=vi&amp;token=' + token));
});

test('SMTP sends to the user address over verified TLS, with the same Global Success template', async () => {
  const { service, calls } = load({ ...smtpEnv, RESEND_API_KEY: 'unused-key' });
  assert.equal(service.isPasswordResetEmailConfigured(), true);
  const token = 'cd'.repeat(32);
  await service.sendPasswordResetEmail('another-user@example.test', token);
  assert.equal(calls.http.length, 0);
  assert.equal(calls.messages[0].to[0], 'another-user@example.test');
  assert.ok(calls.messages[0].text.includes('scholarship://reset-password?token=' + token));
  assert.ok(calls.messages[0].subject.includes('Global Success'));
  const options = calls.options[0];
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.notEqual(options.tls.rejectUnauthorized, false);
  assert.equal(options.auth.pass, 'testapppasswordonly');
  assert.equal(options.logger, false);
  assert.equal(options.debug, false);
});

test('SMTP on port 587 requires STARTTLS and preserves non-Gmail passwords', async () => {
  const { service, calls } = load({ ...smtpEnv, SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_PASS: ' with spaces ' });
  await service.sendPasswordResetEmail('user@example.test', 'ef'.repeat(32));
  assert.equal(calls.options[0].secure, false);
  assert.equal(calls.options[0].requireTLS, true);
  assert.equal(calls.options[0].auth.pass, ' with spaces ');
});

test('incomplete or invalid SMTP configuration cannot silently select Resend', async () => {
  for (const overrides of [
    { SMTP_PASS: '' }, { SMTP_USER: '' }, { SMTP_HOST: '' },
    { SMTP_PORT: 'invalid' }, { SMTP_PORT: '0' }, { SMTP_PORT: '65536' },
    { PASSWORD_RESET_URL: 'not a URL' }, { PASSWORD_RESET_FROM: '' },
    { PASSWORD_RESET_PROVIDER: 'unknown' },
  ]) {
    const { service, calls } = load({ ...smtpEnv, RESEND_API_KEY: 'unused-key', ...overrides });
    assert.equal(service.isPasswordResetEmailConfigured(), false);
    await assert.rejects(service.sendPasswordResetEmail('user@example.test', 'aa'.repeat(32)));
    assert.equal(calls.http.length, 0);
    assert.equal(calls.options.length, 0);
  }
});

test('failed SMTP authentication propagates for token cleanup, without sending through a fallback', async () => {
  const error = Object.assign(new Error('test authentication failure'), { code: 'EAUTH', responseCode: 535 });
  const { service, calls } = load({ ...smtpEnv, RESEND_API_KEY: 'unused-key' }, { smtpError: error });
  await assert.rejects(service.sendPasswordResetEmail('user@example.test', 'aa'.repeat(32)), e => e === error);
  assert.equal(calls.http.length, 0);
});

test('SMTP diagnostic authenticates without sending a reset message', async () => {
  const { service, calls } = load(smtpEnv);
  assert.equal(await service.verifyPasswordResetSmtp(), true);
  assert.equal(calls.verify, 1);
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.http.length, 0);
  const invalid = load({ ...smtpEnv, SMTP_PASS: '' });
  await assert.rejects(invalid.service.verifyPasswordResetSmtp(), { code: 'EMAIL_CONFIG' });
});
