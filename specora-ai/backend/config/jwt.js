const crypto = require('crypto');

/**
 * Single source of truth for the JWT signing secret.
 *
 * SECURITY: there is deliberately no hardcoded fallback. A shared, published
 * default secret would let anyone forge a token for any account. In production
 * a missing JWT_SECRET is fatal; in development we fall back to a random
 * per-process secret (which invalidates tokens on restart — set JWT_SECRET in
 * .env to keep sessions stable).
 */
function resolveSecret() {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.trim()) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  }

  console.warn(
    'WARNING: JWT_SECRET is not set. Using a random development secret — ' +
      'all sessions will be invalidated when the server restarts.'
  );
  return crypto.randomBytes(48).toString('hex');
}

module.exports = { JWT_SECRET: resolveSecret() };
