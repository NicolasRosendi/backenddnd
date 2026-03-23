const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dnd-ficha-secret-cambiar-en-produccion';
const JWT_EXPIRES = '7d';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = { generateToken, authMiddleware, JWT_SECRET };
