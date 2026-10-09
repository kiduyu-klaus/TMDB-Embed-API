// Stream API token authentication.
//
// Design notes:
//  - The server stores ONLY a SHA-256 hash (STREAM_TOKEN_HASH). The plaintext
//    password is never persisted and is never echoed back to the admin panel.
//  - A caller may authenticate in either of two equivalent ways:
//      1. ?token=<the hash itself>   (what the Keys panel displays + copies)
//      2. ?token=<the password>      (convenience, when sha256(password) matches)
//    Both comparisons are constant-time.
//  - If no hash is configured, stream auth is DISABLED and requests pass through.

const crypto = require('crypto');

const TOKEN_MIN_LEN = 8;
const TOKEN_MAX_LEN = 64;
// "8-64 letters or numbers only"
const TOKEN_PATTERN = /^[A-Za-z0-9]+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function hashStreamToken(password) {
  return crypto.createHash('sha256').update(String(password), 'utf8').digest('hex');
}

// Accept only a syntactically valid plaintext token password, so the server
// never stores a hash of something the UI told the user was invalid.
function isValidStreamTokenFormat(password) {
  if (typeof password !== 'string') return false;
  const value = password.trim();
  if (value.length < TOKEN_MIN_LEN || value.length > TOKEN_MAX_LEN) return false;
  return TOKEN_PATTERN.test(value);
}

// Coerce whatever came out of .env / user-config.json into a canonical hash.
function normalizeTokenHash(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(value)) return null;
  return value;
}

// Lazy require to avoid a load-time cycle: config.js also requires this module.
function getConfiguredTokenHash() {
  const { config } = require('./config');
  return normalizeTokenHash(config.streamTokenHash);
}

function isStreamTokenEnabled() {
  return getConfiguredTokenHash() !== null;
}

function safeEqualsHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyStreamToken(provided) {
  const expected = getConfiguredTokenHash();
  if (!expected) return true; // auth disabled
  if (typeof provided !== 'string' || !provided.trim()) return false;

  const candidate = provided.trim();
  // Form 1: the caller passed the stored hash directly.
  if (candidate.length === 64 && SHA256_HEX_PATTERN.test(candidate.toLowerCase())) {
    if (safeEqualsHex(candidate.toLowerCase(), expected)) return true;
  }
  // Form 2: the caller passed the plaintext password.
  return safeEqualsHex(hashStreamToken(candidate), expected);
}

// Express middleware for the /api/streams routes.
function requireStreamToken(req, res, next) {
  if (!isStreamTokenEnabled()) return next();

  const token = req.query ? req.query.token : undefined;
  if (token === undefined || token === null || String(token).trim() === '') {
    return res.status(401).json({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
      message: 'A token query parameter is required to access stream endpoints.'
    });
  }
  if (!verifyStreamToken(token)) {
    return res.status(403).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'The supplied token is not valid.'
    });
  }
  next();
}

module.exports = {
  hashStreamToken,
  isValidStreamTokenFormat,
  normalizeTokenHash,
  getConfiguredTokenHash,
  isStreamTokenEnabled,
  verifyStreamToken,
  requireStreamToken,
  TOKEN_MIN_LEN,
  TOKEN_MAX_LEN
};