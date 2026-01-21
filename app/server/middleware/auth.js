// Middleware de autenticação simples por wallet
const jwt = require('jsonwebtoken');
const config = require('../config');

// Gera token JWT para um usuário
function generateToken(userId, walletAddress) {
  return jwt.sign(
    { userId, walletAddress },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Verifica token JWT
function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch {
    return null;
  }
}

// Middleware de autenticação
function authMiddleware(req, res, next) {
  // Em desenvolvimento local, permite acesso sem auth
  if (config.NODE_ENV === 'development' && !config.DATABASE_URL) {
    req.user = { id: 1, walletAddress: 'local' };
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  req.user = {
    id: decoded.userId,
    walletAddress: decoded.walletAddress
  };

  next();
}

// Middleware opcional - não bloqueia se não tiver auth
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = {
        id: decoded.userId,
        walletAddress: decoded.walletAddress
      };
    }
  }

  // Fallback para desenvolvimento local
  if (!req.user && config.NODE_ENV === 'development' && !config.DATABASE_URL) {
    req.user = { id: 1, walletAddress: 'local' };
  }

  next();
}

module.exports = {
  generateToken,
  verifyToken,
  authMiddleware,
  optionalAuth
};
