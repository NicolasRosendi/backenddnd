const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');

const router = express.Router();

// Todos los endpoints requieren auth
router.use(authMiddleware);

// ── LISTAR mis fichas ─────────────────────
router.get('/', (req, res) => {
  try {
    const chars = db.prepare(
      'SELECT id, name, created_at, updated_at FROM characters WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(req.user.id);
    res.json({ characters: chars });
  } catch (err) {
    console.error('Error listando personajes:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── OBTENER una ficha ─────────────────────
router.get('/:id', (req, res) => {
  try {
    const char = db.prepare(
      'SELECT * FROM characters WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });

    // Parsear data JSON
    char.data = JSON.parse(char.data);
    res.json({ character: char });
  } catch (err) {
    console.error('Error obteniendo personaje:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── OBTENER ficha pública (para combate) ──
router.get('/public/:id', (req, res) => {
  try {
    const char = db.prepare(
      'SELECT id, user_id, name, data FROM characters WHERE id = ?'
    ).get(req.params.id);

    if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });

    const data = JSON.parse(char.data);
    // Solo devolver datos relevantes para combate
    res.json({
      character: {
        id: char.id,
        user_id: char.user_id,
        name: char.name,
        combat: {
          ac: data.ac || 10,
          hpCurr: data.hpCurr || 0,
          hpMax: data.hpMax || 0,
          initiative: data.initiative || '+0',
          attacks: data.attacks || [],
          stats: data.stats || {},
        }
      }
    });
  } catch (err) {
    console.error('Error obteniendo personaje público:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── CREAR ficha ───────────────────────────
router.post('/', (req, res) => {
  try {
    const { name, data } = req.body;
    const charName = name || 'Nuevo Personaje';
    const charData = JSON.stringify(data || getDefaultCharData());

    const result = db.prepare(
      'INSERT INTO characters (user_id, name, data) VALUES (?, ?, ?)'
    ).run(req.user.id, charName, charData);

    res.status(201).json({
      character: {
        id: result.lastInsertRowid,
        name: charName,
        data: JSON.parse(charData),
      }
    });
  } catch (err) {
    console.error('Error creando personaje:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── ACTUALIZAR ficha ──────────────────────
router.put('/:id', (req, res) => {
  try {
    // Verificar que es mío
    const existing = db.prepare(
      'SELECT id FROM characters WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!existing) return res.status(404).json({ error: 'Personaje no encontrado' });

    const { name, data } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (data !== undefined) { updates.push('data = ?'); params.push(JSON.stringify(data)); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id, req.user.id);

    db.prepare(
      `UPDATE characters SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...params);

    res.json({ success: true });
  } catch (err) {
    console.error('Error actualizando personaje:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── BORRAR ficha ──────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare(
      'DELETE FROM characters WHERE id = ? AND user_id = ?'
    ).run(req.params.id, req.user.id);

    if (result.changes === 0) return res.status(404).json({ error: 'Personaje no encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error borrando personaje:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Ficha por defecto ─────────────────────
function getDefaultCharData() {
  return {
    charName: 'Nuevo Personaje',
    class: 'Clase lvl1',
    background: '',
    race: '',
    alignment: '',
    player: '',
    xp: '0 / 300 XP',
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    hpCurr: 10,
    hpMax: 10,
    hpTemp: 0,
    profBonus: 2,
    ac: 10,
    initiative: '+0',
    speed: '30ft',
    hitDice: 'd8+0',
    hdTotal: 1,
    savingThrowProf: [],
    skillProf: [],
    skillExpertise: [],
    spellAbilityKey: 'int',
    attacks: [],
    inventory: [],
    spells: {},
    proficiencies: '',
    personality: '',
    ideals: '',
    bonds: '',
    flaws: '',
    traits: '',
    age: '—',
    height: '—',
    weight: '—',
    eyes: '—',
    skin: '—',
    hair: '—',
    appearance: '—',
    backstory: '—',
    allies: '—',
    treasure: '—',
    additionalTraits: '—',
    armorCA: 10,
    armorName: 'Sin armadura',
  };
}

module.exports = router;
