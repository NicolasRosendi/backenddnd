const Database = require('better-sqlite3');
const path = require('path');

// Render usa /opt/render/project/src para persistent disk, fallback a local
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dnd.db');

// Asegurar que el directorio exista
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode para mejor concurrencia
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ══════════════════════════════════════
//  SCHEMA
// ══════════════════════════════════════

db.exec(`
  -- Usuarios
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    UNIQUE NOT NULL,
    password    TEXT    NOT NULL,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  -- Fichas de personaje (1 usuario puede tener varias)
  CREATE TABLE IF NOT EXISTS characters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    name        TEXT    NOT NULL DEFAULT 'Nuevo Personaje',
    data        TEXT    NOT NULL DEFAULT '{}',
    created_at  TEXT    DEFAULT (datetime('now')),
    updated_at  TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Mesas de juego (como "canales")
  CREATE TABLE IF NOT EXISTS tables (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    code        TEXT    UNIQUE NOT NULL,
    owner_id    INTEGER NOT NULL,
    status      TEXT    DEFAULT 'lobby',
    created_at  TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Jugadores en una mesa
  CREATE TABLE IF NOT EXISTS table_players (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id      INTEGER NOT NULL,
    user_id       INTEGER NOT NULL,
    character_id  INTEGER NOT NULL,
    initiative    INTEGER DEFAULT 0,
    is_ready      INTEGER DEFAULT 0,
    joined_at     TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (table_id)     REFERENCES tables(id)     ON DELETE CASCADE,
    FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters(id)  ON DELETE CASCADE,
    UNIQUE(table_id, user_id)
  );

  -- Log de combate
  CREATE TABLE IF NOT EXISTS combat_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id      INTEGER NOT NULL,
    round         INTEGER DEFAULT 1,
    attacker_id   INTEGER NOT NULL,
    defender_id   INTEGER NOT NULL,
    attack_roll   INTEGER NOT NULL,
    attack_bonus  INTEGER DEFAULT 0,
    attack_total  INTEGER NOT NULL,
    defender_ac   INTEGER NOT NULL,
    hit           INTEGER NOT NULL,
    damage_roll   TEXT    DEFAULT NULL,
    damage_total  INTEGER DEFAULT 0,
    timestamp     TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (table_id)    REFERENCES tables(id)     ON DELETE CASCADE,
    FOREIGN KEY (attacker_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (defender_id) REFERENCES characters(id) ON DELETE CASCADE
  );

  -- Estado de combate en mesa
  CREATE TABLE IF NOT EXISTS combat_state (
    table_id        INTEGER PRIMARY KEY,
    current_round   INTEGER DEFAULT 1,
    current_turn    INTEGER DEFAULT 0,
    turn_order      TEXT    DEFAULT '[]',
    status          TEXT    DEFAULT 'waiting',
    FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
  );
`);

module.exports = db;
