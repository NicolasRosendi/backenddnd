const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');

const router = express.Router();
router.use(authMiddleware);

// ══════════════════════════════════════
//  MESAS (TABLAS DE JUEGO)
// ══════════════════════════════════════

// Generar código de mesa (6 chars alfanumérico)
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I,O,0,1 para evitar confusión
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── CREAR MESA ────────────────────────
router.post('/', (req, res) => {
  try {
    const { name, visibility, password } = req.body;
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Nombre de mesa requerido (mín. 2 chars)' });
    }

    const vis = (visibility === 'public') ? 'public' : 'private';
    const pwd = (vis === 'private' && password) ? password : null;

    let code;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
    } while (db.prepare('SELECT id FROM tables WHERE code = ?').get(code) && attempts < 10);

    const result = db.prepare(
      'INSERT INTO tables (name, code, owner_id, visibility, password) VALUES (?, ?, ?, ?, ?)'
    ).run(name, code, req.user.id, vis, pwd);

    // Crear estado de combate
    db.prepare(
      'INSERT INTO combat_state (table_id) VALUES (?)'
    ).run(result.lastInsertRowid);

    res.status(201).json({
      table: {
        id: result.lastInsertRowid,
        name,
        code,
        owner_id: req.user.id,
        status: 'lobby',
        visibility: vis
      }
    });
  } catch (err) {
    console.error('Error creando mesa:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── LISTAR MIS MESAS (las que creé + las que me uní) ──
router.get('/', (req, res) => {
  try {
    const tables = db.prepare(`
      SELECT DISTINCT t.*, 
        (SELECT COUNT(*) FROM table_players tp WHERE tp.table_id = t.id) as player_count,
        CASE WHEN t.owner_id = ? THEN 1 ELSE 0 END as is_owner
      FROM tables t
      LEFT JOIN table_players tp ON tp.table_id = t.id
      WHERE t.owner_id = ? OR tp.user_id = ?
      ORDER BY t.created_at DESC
    `).all(req.user.id, req.user.id, req.user.id);

    res.json({ tables });
  } catch (err) {
    console.error('Error listando mesas:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── LISTAR MESAS PÚBLICAS ─────────────
router.get('/public', (req, res) => {
  try {
    const tables = db.prepare(`
      SELECT t.id, t.name, t.code, t.status, t.visibility, t.owner_id, t.created_at,
        (SELECT COUNT(*) FROM table_players tp WHERE tp.table_id = t.id) as player_count,
        u.username as owner_name,
        CASE WHEN t.owner_id = ? THEN 1 ELSE 0 END as is_owner,
        CASE WHEN EXISTS(SELECT 1 FROM table_players tp2 WHERE tp2.table_id = t.id AND tp2.user_id = ?) THEN 1 ELSE 0 END as already_joined
      FROM tables t
      JOIN users u ON u.id = t.owner_id
      WHERE t.visibility = 'public'
      ORDER BY t.created_at DESC
      LIMIT 50
    `).all(req.user.id, req.user.id);

    res.json({ tables });
  } catch (err) {
    console.error('Error listando mesas públicas:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── OBTENER MESA POR CÓDIGO ───────────
router.get('/join/:code', (req, res) => {
  try {
    const table = db.prepare('SELECT id, name, code, status, visibility, owner_id, created_at, CASE WHEN password IS NOT NULL AND password != "" THEN 1 ELSE 0 END as has_password FROM tables WHERE code = ?').get(req.params.code.toUpperCase());
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    // No revelar el password real, solo si tiene
    table.password = table.has_password ? true : false;
    delete table.has_password;
    res.json({ table });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── DETALLE DE MESA ───────────────────
router.get('/:id', (req, res) => {
  try {
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    // Jugadores en la mesa
    const players = db.prepare(`
      SELECT tp.*, u.username, c.name as character_name, c.data as character_data
      FROM table_players tp
      JOIN users u ON u.id = tp.user_id
      JOIN characters c ON c.id = tp.character_id
      WHERE tp.table_id = ?
      ORDER BY tp.initiative DESC
    `).all(req.params.id);

    // Parsear data de cada personaje
    players.forEach(p => {
      try { p.character_data = JSON.parse(p.character_data); } catch { p.character_data = {}; }
    });

    // Estado de combate
    const combat = db.prepare('SELECT * FROM combat_state WHERE table_id = ?').get(req.params.id);
    if (combat && combat.turn_order) {
      try { combat.turn_order = JSON.parse(combat.turn_order); } catch { combat.turn_order = []; }
    }

    // Log de combate reciente (últimas 20 acciones)
    const log = db.prepare(`
      SELECT cl.*, 
        ca.name as attacker_name,
        cd.name as defender_name
      FROM combat_log cl
      JOIN characters ca ON ca.id = cl.attacker_id
      JOIN characters cd ON cd.id = cl.defender_id
      WHERE cl.table_id = ?
      ORDER BY cl.timestamp DESC
      LIMIT 20
    `).all(req.params.id);

    res.json({ table, players, combat, log: log.reverse() });
  } catch (err) {
    console.error('Error obteniendo mesa:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── UNIRSE A MESA ─────────────────────
router.post('/:id/join', (req, res) => {
  try {
    const { character_id, password } = req.body;
    if (!character_id) return res.status(400).json({ error: 'Seleccioná un personaje' });

    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    // Si es privada con password y no soy el dueño, verificar password
    if (table.visibility === 'private' && table.password && table.owner_id !== req.user.id) {
      if (!password || password !== table.password) {
        return res.status(403).json({ error: 'Contraseña incorrecta' });
      }
    }

    // Verificar que el personaje es mío
    const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?')
      .get(character_id, req.user.id);
    if (!char) return res.status(403).json({ error: 'Ese personaje no es tuyo' });

    // Verificar que no estoy ya en la mesa
    const existing = db.prepare('SELECT id FROM table_players WHERE table_id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (existing) return res.status(409).json({ error: 'Ya estás en esta mesa' });

    db.prepare(
      'INSERT INTO table_players (table_id, user_id, character_id) VALUES (?, ?, ?)'
    ).run(req.params.id, req.user.id, character_id);

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Error uniéndose a mesa:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── SALIR DE MESA ─────────────────────
router.post('/:id/leave', (req, res) => {
  try {
    db.prepare('DELETE FROM table_players WHERE table_id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ══════════════════════════════════════
//  COMBATE
// ══════════════════════════════════════

// ── INICIAR COMBATE (solo owner) ──────
router.post('/:id/combat/start', (req, res) => {
  try {
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (table.owner_id !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede iniciar combate' });

    const players = db.prepare(`
      SELECT tp.*, c.data as character_data, c.id as char_id, c.name as character_name
      FROM table_players tp
      JOIN characters c ON c.id = tp.character_id
      WHERE tp.table_id = ?
    `).all(req.params.id);

    if (players.length < 2) {
      return res.status(400).json({ error: 'Se necesitan al menos 2 jugadores' });
    }

    // Tirar iniciativa para cada jugador
    const initiatives = players.map(p => {
      const data = JSON.parse(p.character_data);
      const dexMod = Math.floor(((data.stats?.dex || 10) - 10) / 2);
      const roll = Math.floor(Math.random() * 20) + 1;
      const total = roll + dexMod;

      // Guardar iniciativa en table_players
      db.prepare('UPDATE table_players SET initiative = ? WHERE id = ?').run(total, p.id);

      return {
        player_id: p.id,
        user_id: p.user_id,
        character_id: p.char_id,
        character_name: p.character_name,
        roll,
        dex_mod: dexMod,
        total,
      };
    });

    // Ordenar por iniciativa (mayor primero)
    initiatives.sort((a, b) => b.total - a.total);

    // Actualizar estado de combate
    db.prepare(`
      UPDATE combat_state 
      SET current_round = 1, current_turn = 0, turn_order = ?, status = 'active'
      WHERE table_id = ?
    `).run(JSON.stringify(initiatives), req.params.id);

    // Actualizar estado de mesa
    db.prepare("UPDATE tables SET status = 'combat' WHERE id = ?").run(req.params.id);

    // Limpiar log anterior
    db.prepare('DELETE FROM combat_log WHERE table_id = ?').run(req.params.id);

    res.json({ 
      success: true, 
      initiatives,
      message: 'Combate iniciado. Orden de turnos establecido por iniciativa.'
    });
  } catch (err) {
    console.error('Error iniciando combate:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── ATACAR ─────────────────────────────
router.post('/:id/combat/attack', (req, res) => {
  try {
    const { defender_character_id, attack_index } = req.body;
    if (defender_character_id === undefined) {
      return res.status(400).json({ error: 'Seleccioná un objetivo' });
    }

    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table || table.status !== 'combat') {
      return res.status(400).json({ error: 'No hay combate activo en esta mesa' });
    }

    const combat = db.prepare('SELECT * FROM combat_state WHERE table_id = ?').get(req.params.id);
    if (!combat || combat.status !== 'active') {
      return res.status(400).json({ error: 'Combate no activo' });
    }

    const turnOrder = JSON.parse(combat.turn_order);
    const currentTurn = turnOrder[combat.current_turn];

    if (!currentTurn) return res.status(400).json({ error: 'Error en orden de turno' });

    // Verificar que es el turno del jugador
    if (currentTurn.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No es tu turno' });
    }

    // Obtener datos del atacante
    const attackerChar = db.prepare('SELECT * FROM characters WHERE id = ?')
      .get(currentTurn.character_id);
    if (!attackerChar) return res.status(404).json({ error: 'Personaje atacante no encontrado' });
    const attackerData = JSON.parse(attackerChar.data);

    // Obtener datos del defensor
    const defenderChar = db.prepare('SELECT * FROM characters WHERE id = ?')
      .get(defender_character_id);
    if (!defenderChar) return res.status(404).json({ error: 'Personaje defensor no encontrado' });
    const defenderData = JSON.parse(defenderChar.data);

    // Obtener arma seleccionada
    const attacks = attackerData.attacks || [];
    const atkIdx = attack_index || 0;
    const weapon = attacks[atkIdx] || { name: 'Ataque', bonus: '+0', dmg: '1d4' };

    // Parsear bonus de ataque
    const attackBonus = parseInt(weapon.bonus) || 0;

    // ── TIRADA DE ATAQUE ──
    const attackRoll = Math.floor(Math.random() * 20) + 1;
    const attackTotal = attackRoll + attackBonus;
    const isCrit = attackRoll === 20;
    const isFumble = attackRoll === 1;

    // Obtener CA del defensor
    const defenderAC = parseInt(defenderData.ac) || 10;

    // ¿Impacta?
    const hits = isCrit || (!isFumble && attackTotal >= defenderAC);

    let damageRoll = null;
    let damageTotal = 0;
    let damageDetails = null;

    if (hits) {
      // ── TIRADA DE DAÑO ──
      const dmgParsed = parseDamage(weapon.dmg);
      damageDetails = rollDamage(dmgParsed, isCrit);
      damageTotal = damageDetails.total;
      damageRoll = damageDetails.formula;

      // Aplicar daño al defensor
      const newHP = Math.max(0, (defenderData.hpCurr || 0) - damageTotal);
      defenderData.hpCurr = newHP;
      db.prepare('UPDATE characters SET data = ? WHERE id = ?')
        .run(JSON.stringify(defenderData), defender_character_id);
    }

    // ── GUARDAR EN LOG ──
    db.prepare(`
      INSERT INTO combat_log (table_id, round, attacker_id, defender_id, attack_roll, attack_bonus, attack_total, defender_ac, hit, damage_roll, damage_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id,
      combat.current_round,
      currentTurn.character_id,
      defender_character_id,
      attackRoll,
      attackBonus,
      attackTotal,
      defenderAC,
      hits ? 1 : 0,
      damageRoll,
      damageTotal
    );

    // ── AVANZAR TURNO ──
    let nextTurn = combat.current_turn + 1;
    let nextRound = combat.current_round;
    if (nextTurn >= turnOrder.length) {
      nextTurn = 0;
      nextRound++;
    }

    // ── CHECK AUTO-END: si quedan solo 2 jugadores y uno cayó ──
    let combatEnded = false;
    let winner = null;
    if (hits && defenderData.hpCurr <= 0) {
      // Contar cuántos jugadores tenían vida al inicio del combate
      const totalPlayers = turnOrder.length;
      if (totalPlayers === 2) {
        // Pelea 1v1: termina automáticamente
        combatEnded = true;
        winner = attackerChar.name;
        db.prepare("UPDATE combat_state SET status = 'ended' WHERE table_id = ?").run(req.params.id);
        db.prepare("UPDATE tables SET status = 'lobby' WHERE id = ?").run(req.params.id);
      } else {
        // Más de 2: verificar cuántos siguen vivos
        const alivePlayers = turnOrder.filter(t => {
          const c = db.prepare('SELECT data FROM characters WHERE id = ?').get(t.character_id);
          if (!c) return false;
          const d = JSON.parse(c.data);
          return (d.hpCurr || 0) > 0;
        });
        if (alivePlayers.length <= 1) {
          combatEnded = true;
          winner = alivePlayers.length === 1 ? alivePlayers[0].character_name : null;
          db.prepare("UPDATE combat_state SET status = 'ended' WHERE table_id = ?").run(req.params.id);
          db.prepare("UPDATE tables SET status = 'lobby' WHERE id = ?").run(req.params.id);
        }
      }
    }

    if (!combatEnded) {
      db.prepare(`
        UPDATE combat_state SET current_turn = ?, current_round = ? WHERE table_id = ?
      `).run(nextTurn, nextRound, req.params.id);
    }

    const nextPlayer = combatEnded ? null : turnOrder[nextTurn];

    res.json({
      result: {
        attacker: attackerChar.name,
        defender: defenderChar.name,
        weapon: weapon.name,
        attack_roll: attackRoll,
        attack_bonus: attackBonus,
        attack_total: attackTotal,
        is_crit: isCrit,
        is_fumble: isFumble,
        defender_ac: defenderAC,
        hits,
        damage: hits ? {
          formula: damageRoll,
          total: damageTotal,
          details: damageDetails,
        } : null,
        defender_hp_remaining: hits ? defenderData.hpCurr : null,
        defender_down: hits && defenderData.hpCurr <= 0,
      },
      combat_ended: combatEnded,
      winner: winner,
      next_turn: combatEnded ? null : {
        round: nextRound,
        turn_index: nextTurn,
        character_name: nextPlayer?.character_name,
        user_id: nextPlayer?.user_id,
      }
    });
  } catch (err) {
    console.error('Error en ataque:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── APLICAR DAÑO MANUAL ───────────────
router.post('/:id/combat/manual-damage', (req, res) => {
  try {
    const { defender_character_id, damage, description } = req.body;
    if (!defender_character_id || !damage || damage <= 0) {
      return res.status(400).json({ error: 'Objetivo y daño requeridos' });
    }

    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table || table.status !== 'combat') return res.status(400).json({ error: 'No hay combate activo' });

    const combat = db.prepare('SELECT * FROM combat_state WHERE table_id = ?').get(req.params.id);
    if (!combat || combat.status !== 'active') return res.status(400).json({ error: 'Combate no activo' });

    const turnOrder = JSON.parse(combat.turn_order);
    const currentTurn = turnOrder[combat.current_turn];
    if (currentTurn.user_id !== req.user.id) return res.status(403).json({ error: 'No es tu turno' });

    // Aplicar daño
    const defenderChar = db.prepare('SELECT * FROM characters WHERE id = ?').get(defender_character_id);
    if (!defenderChar) return res.status(404).json({ error: 'Defensor no encontrado' });
    const defenderData = JSON.parse(defenderChar.data);
    const oldHP = defenderData.hpCurr || 0;
    defenderData.hpCurr = Math.max(0, oldHP - damage);
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(defenderData), defender_character_id);

    // Log
    const attackerChar = db.prepare('SELECT name FROM characters WHERE id = ?').get(currentTurn.character_id);
    db.prepare(`
      INSERT INTO combat_log (table_id, round, attacker_id, defender_id, attack_roll, attack_bonus, attack_total, defender_ac, hit, damage_roll, damage_total)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1, ?, ?)
    `).run(req.params.id, combat.current_round, currentTurn.character_id, defender_character_id, description || 'manual', damage);

    // Check auto-end
    let combatEnded = false;
    let winner = null;
    if (defenderData.hpCurr <= 0) {
      const alivePlayers = turnOrder.filter(t => {
        const c = db.prepare('SELECT data FROM characters WHERE id = ?').get(t.character_id);
        if (!c) return false;
        const d = JSON.parse(c.data);
        return (d.hpCurr || 0) > 0;
      });
      if (alivePlayers.length <= 1) {
        combatEnded = true;
        winner = alivePlayers.length === 1 ? alivePlayers[0].character_name : null;
        db.prepare("UPDATE combat_state SET status = 'ended' WHERE table_id = ?").run(req.params.id);
        db.prepare("UPDATE tables SET status = 'lobby' WHERE id = ?").run(req.params.id);
      }
    }

    // Avanzar turno
    if (!combatEnded) {
      let nextTurn = combat.current_turn + 1;
      let nextRound = combat.current_round;
      if (nextTurn >= turnOrder.length) { nextTurn = 0; nextRound++; }
      db.prepare('UPDATE combat_state SET current_turn = ?, current_round = ? WHERE table_id = ?').run(nextTurn, nextRound, req.params.id);
      const nextPlayer = turnOrder[nextTurn];
      res.json({
        success: true,
        damage_applied: damage,
        defender_name: defenderChar.name,
        defender_hp: defenderData.hpCurr,
        defender_down: defenderData.hpCurr <= 0,
        combat_ended: false,
        next_turn: { round: nextRound, turn_index: nextTurn, character_name: nextPlayer?.character_name, user_id: nextPlayer?.user_id }
      });
    } else {
      res.json({ success: true, damage_applied: damage, defender_name: defenderChar.name, defender_hp: 0, defender_down: true, combat_ended: true, winner });
    }
  } catch (err) {
    console.error('Error daño manual:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── TIRADA DE SALVACIÓN (conjuro) ─────
router.post('/:id/combat/saving-throw', (req, res) => {
  try {
    const { defender_character_id, stat, spell_dc } = req.body;
    if (!defender_character_id || !stat || !spell_dc) {
      return res.status(400).json({ error: 'Objetivo, stat y CD requeridos' });
    }

    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table || table.status !== 'combat') return res.status(400).json({ error: 'No hay combate activo' });

    const combat = db.prepare('SELECT * FROM combat_state WHERE table_id = ?').get(req.params.id);
    if (!combat || combat.status !== 'active') return res.status(400).json({ error: 'Combate no activo' });

    const turnOrder = JSON.parse(combat.turn_order);
    const currentTurn = turnOrder[combat.current_turn];
    if (currentTurn.user_id !== req.user.id) return res.status(403).json({ error: 'No es tu turno' });

    // Obtener stat del defensor
    const defenderChar = db.prepare('SELECT * FROM characters WHERE id = ?').get(defender_character_id);
    if (!defenderChar) return res.status(404).json({ error: 'Defensor no encontrado' });
    const defenderData = JSON.parse(defenderChar.data);
    const statVal = (defenderData.stats && defenderData.stats[stat]) || 10;
    const statMod = Math.floor((statVal - 10) / 2);

    // Verificar proficiencia en salvación
    const saveProf = (defenderData.savingThrowProf || []).includes(stat);
    const profBonus = saveProf ? (defenderData.profBonus || 2) : 0;

    // Tirar salvación
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + statMod + profBonus;
    const success = total >= spell_dc;

    const statNames = { str: 'Fuerza', dex: 'Destreza', con: 'Constitución', int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma' };

    res.json({
      defender_name: defenderChar.name,
      stat: stat,
      stat_name: statNames[stat] || stat,
      stat_mod: statMod,
      prof_bonus: profBonus,
      roll,
      total,
      spell_dc: parseInt(spell_dc),
      success,
      message: success
        ? defenderChar.name + ' supera la salvación de ' + (statNames[stat] || stat) + ' (' + total + ' >= ' + spell_dc + ')'
        : defenderChar.name + ' falla la salvación de ' + (statNames[stat] || stat) + ' (' + total + ' < ' + spell_dc + ')'
    });
  } catch (err) {
    console.error('Error tirada salvación:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── PASAR TURNO ───────────────────────
router.post('/:id/combat/pass', (req, res) => {
  try {
    const combat = db.prepare('SELECT * FROM combat_state WHERE table_id = ?').get(req.params.id);
    if (!combat || combat.status !== 'active') {
      return res.status(400).json({ error: 'Combate no activo' });
    }

    const turnOrder = JSON.parse(combat.turn_order);
    const currentTurn = turnOrder[combat.current_turn];

    if (currentTurn.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No es tu turno' });
    }

    let nextTurn = combat.current_turn + 1;
    let nextRound = combat.current_round;
    if (nextTurn >= turnOrder.length) {
      nextTurn = 0;
      nextRound++;
    }

    db.prepare('UPDATE combat_state SET current_turn = ?, current_round = ? WHERE table_id = ?')
      .run(nextTurn, nextRound, req.params.id);

    const nextPlayer = turnOrder[nextTurn];
    res.json({
      success: true,
      next_turn: {
        round: nextRound,
        turn_index: nextTurn,
        character_name: nextPlayer?.character_name,
        user_id: nextPlayer?.user_id,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── TERMINAR COMBATE (solo owner) ─────
router.post('/:id/combat/end', (req, res) => {
  try {
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (table.owner_id !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede terminar el combate' });

    db.prepare("UPDATE combat_state SET status = 'ended' WHERE table_id = ?").run(req.params.id);
    db.prepare("UPDATE tables SET status = 'lobby' WHERE id = ?").run(req.params.id);

    res.json({ success: true, message: 'Combate finalizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── OBTENER ESTADO DE COMBATE ─────────
router.get('/:id/combat', (req, res) => {
  try {
    const combat = db.prepare('SELECT * FROM combat_state WHERE table_id = ?').get(req.params.id);
    if (!combat) return res.status(404).json({ error: 'Estado de combate no encontrado' });

    combat.turn_order = JSON.parse(combat.turn_order || '[]');

    // Obtener HP actual de todos los personajes en la mesa
    const players = db.prepare(`
      SELECT tp.user_id, c.id as character_id, c.name, c.data
      FROM table_players tp
      JOIN characters c ON c.id = tp.character_id
      WHERE tp.table_id = ?
    `).all(req.params.id);

    const hpStatus = players.map(p => {
      const data = JSON.parse(p.data);
      return {
        character_id: p.character_id,
        name: p.name,
        user_id: p.user_id,
        hpCurr: data.hpCurr || 0,
        hpMax: data.hpMax || 0,
        ac: data.ac || 10,
      };
    });

    res.json({ combat, hp_status: hpStatus });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ══════════════════════════════════════
//  HELPERS DE DAÑO
// ══════════════════════════════════════

// Parsear "2d6+3", "1d8", "1d4+2 slashing", etc.
function parseDamage(dmgStr) {
  if (!dmgStr) return { count: 1, faces: 4, mod: 0 };
  
  const clean = dmgStr.replace(/\s*(slashing|piercing|bludgeoning|fire|cold|lightning|thunder|poison|acid|necrotic|radiant|force|psychic)\s*/gi, '').trim();
  
  // Intentar parsear formato XdY+Z o XdY(dZ)+W
  const match = clean.match(/(\d+)?d(\d+)(?:\(d\d+\))?(?:\s*([+\-])\s*(\d+))?/i);
  if (!match) return { count: 1, faces: 4, mod: 0 };

  return {
    count: parseInt(match[1]) || 1,
    faces: parseInt(match[2]),
    mod: match[3] === '-' ? -(parseInt(match[4]) || 0) : (parseInt(match[4]) || 0),
  };
}

function rollDamage(parsed, isCrit) {
  const diceCount = isCrit ? parsed.count * 2 : parsed.count;
  const rolls = [];
  for (let i = 0; i < diceCount; i++) {
    rolls.push(Math.floor(Math.random() * parsed.faces) + 1);
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = Math.max(0, sum + parsed.mod);

  const modStr = parsed.mod !== 0 ? (parsed.mod > 0 ? '+' + parsed.mod : '' + parsed.mod) : '';
  const formula = `${diceCount}d${parsed.faces}${modStr}`;

  return { rolls, sum, mod: parsed.mod, total, formula, isCrit };
}

// ── BORRAR MESA ───────────────────────
router.delete('/:id', (req, res) => {
  try {
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (table.owner_id !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede borrar la mesa' });

    // Delete all related data
    db.prepare('DELETE FROM combat_log WHERE table_id = ?').run(req.params.id);
    db.prepare('DELETE FROM table_players WHERE table_id = ?').run(req.params.id);
    db.prepare('DELETE FROM tables WHERE id = ?').run(req.params.id);

    res.json({ success: true, message: 'Mesa eliminada' });
  } catch (err) {
    console.error('Error borrando mesa:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
