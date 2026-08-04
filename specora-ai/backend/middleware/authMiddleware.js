const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../config/jwt');

/**
 * JWT authentication guard
 * - Expected header: Authorization: Bearer <token>
 * - Attaches decoded user payload to req.user
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
