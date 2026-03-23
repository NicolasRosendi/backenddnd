const express = require('express');
const cors = require('cors');
const path = require('path');

// Inicializar DB (crea tablas si no existen)
require('./database');

const authRoutes = require('./routes-auth');
const charRoutes = require('./routes-characters');
const tableRoutes = require('./routes-tables');

const app = express();
const PORT = process.env.PORT || 3001;

// ── MIDDLEWARE ─────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Log de requests en dev
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ── RUTAS ─────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/characters', charRoutes);
app.use('/api/tables', tableRoutes);

// ── HEALTH CHECK ──────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ── SERVIR FRONTEND ESTÁTICO (opcional) ─
// Cuando subas el index.html a /public, se sirve automáticamente.
// Por ahora, si no existe, simplemente responde con un mensaje.
const publicPath = path.join(__dirname, '..', 'public');
const fs = require('fs');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return;
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'D&D 5e API activa. Frontend pendiente.', docs: '/api/health' });
  }
});

// ── ERROR HANDLER ─────────────────────
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── START ─────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   D&D 5e Backend - Puerto ${PORT}      ║
  ║   http://localhost:${PORT}             ║
  ╚══════════════════════════════════════╝
  `);
});
