class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.statusCode = 400;
  }
}

function normalizeUsername(raw) {
  if (typeof raw !== 'string') {
    throw new InputError('Username phải là chuỗi ký tự.');
  }
  const value = raw.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(value)) {
    throw new InputError('Username phải dài 3–30 ký tự, chỉ gồm chữ thường, số hoặc dấu gạch dưới.');
  }
  return value;
}

function checkOptionalText(raw, name, max, nullable = true) {
  if (raw === null && nullable) return null;
  if (typeof raw !== 'string') throw new InputError(name + ' phải là chuỗi ký tự.');
  const value = raw.trim();
  if (value.length > max) throw new InputError(name + ' vượt quá ' + max + ' ký tự.');
  if (!value) {
    if (!nullable) throw new InputError(name + ' không được để trống.');
    return null;
  }
  return value;
}

function normalizeImageUrl(value) {
  const url = checkOptionalText(value, 'avatar_url', 2048);
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (['https:', 'http:'].includes(parsed.protocol)) return parsed.href;
  } catch (_) { /* invalid URL */ }
  throw new InputError('avatar_url phải là URL HTTP hoặc HTTPS.');
}

function validateProfileInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InputError('Thông tin hồ sơ không hợp lệ.');
  }
  const allowed = new Set(['full_name', 'username', 'university', 'major', 'bio', 'skills', 'avatar_url']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new InputError('Trường hồ sơ không được phép cập nhật: ' + key);
  }
  if (Object.keys(input).length === 0) throw new InputError('Vui lòng nhập thông tin cần cập nhật.');

  const updated = {};
  for (const [key, val] of Object.entries(input)) {
    if (key === 'username') {
      updated.username = val === null ? null : normalizeUsername(val);
    } else if (key === 'full_name') {
      updated.full_name = checkOptionalText(val, 'Họ tên', 100, false);
    } else if (key === 'university') {
      updated.university = checkOptionalText(val, 'Trường đại học', 150);
    } else if (key === 'major') {
      updated.major = checkOptionalText(val, 'Ngành học', 150);
    } else if (key === 'bio') {
      updated.bio = checkOptionalText(val, 'Tiểu sử', 3000);
    } else if (key === 'avatar_url') {
      updated.avatar_url = normalizeImageUrl(val);
    } else if (key === 'skills') {
      if (val === null) {
        updated.skills = null;
        continue;
      }
      if (!Array.isArray(val) || val.length > 30 ||
          val.some(skill => typeof skill !== 'string' || skill.trim().length === 0 || skill.trim().length > 80)) {
        throw new InputError('skills phải là mảng tối đa 30 kỹ năng, mỗi kỹ năng dài 1–80 ký tự.');
      }
      updated.skills = [...new Set(val.map(skill => skill.trim()))];
    }
  }
  return updated;
}

module.exports = {
  InputError,
  normalizeUsername,
  checkOptionalText,
  validateProfileInput
};
