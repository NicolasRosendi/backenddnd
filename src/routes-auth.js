const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { generateToken } = require('./auth');

const router = express.Router();

// ── REGISTRO ──────────────────────────────
router.post('/register', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    if (username.length < 3 || username.length > 24) {
      return res.status(400).json({ error: 'Usuario debe tener entre 3 y 24 caracteres' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Contraseña debe tener al menos 4 caracteres' });
    }

    // Chequear si existe
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);

    const user = { id: result.lastInsertRowid, username };
    const token = generateToken(user);

    res.status(201).json({ user: { id: user.id, username }, token });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── LOGIN ─────────────────────────────────
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const token = generateToken(user);
    res.json({ user: { id: user.id, username: user.username }, token });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── VERIFICAR TOKEN (GET /auth/me) ────────
router.get('/me', (req, res) => {
  // Este endpoint usa el middleware de auth en el server.js
  const { authMiddleware } = require('./auth');
  // Se llama sin middleware aquí, lo manejamos inline
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('./auth');
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ user: { id: decoded.id, username: decoded.username } });
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
