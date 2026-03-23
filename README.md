# D&D 5e Backend — Fichas + Mesas de Combate

Backend Node.js + Express + SQLite para gestionar fichas de D&D 5e con sistema de mesas de combate multijugador.

## Deploy en Render

### Opción 1: Con render.yaml (recomendado)
1. Subí todo a un repo de GitHub
2. En Render → New → Blueprint → conectá el repo
3. Render lee el `render.yaml` y configura todo automáticamente
4. **IMPORTANTE**: El disk persistente guarda la base de datos SQLite

### Opción 2: Manual
1. New → Web Service → conectá el repo
2. Runtime: Node
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Agregá un Disk:
   - Mount Path: `/opt/render/project/src/data`
   - Size: 1 GB
6. Variables de entorno:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = (un string random largo)
   - `DB_PATH` = `/opt/render/project/src/data/dnd.db`

## API Endpoints

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registrar usuario |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Verificar token |

**Body registro/login:**
```json
{ "username": "nico", "password": "1234" }
```

### Personajes (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/characters` | Listar mis fichas |
| GET | `/api/characters/:id` | Ver una ficha |
| POST | `/api/characters` | Crear ficha |
| PUT | `/api/characters/:id` | Actualizar ficha |
| DELETE | `/api/characters/:id` | Borrar ficha |

### Mesas (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tables` | Listar mis mesas |
| POST | `/api/tables` | Crear mesa (devuelve código) |
| GET | `/api/tables/join/:code` | Buscar mesa por código |
| GET | `/api/tables/:id` | Detalle de mesa con jugadores |
| POST | `/api/tables/:id/join` | Unirse con un personaje |
| POST | `/api/tables/:id/leave` | Salir de una mesa |

### Combate (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/tables/:id/combat/start` | Iniciar combate (solo dueño) |
| GET | `/api/tables/:id/combat` | Estado actual del combate |
| POST | `/api/tables/:id/combat/attack` | Atacar a otro jugador |
| POST | `/api/tables/:id/combat/pass` | Pasar turno |
| POST | `/api/tables/:id/combat/end` | Terminar combate (solo dueño) |

**Body de ataque:**
```json
{ "defender_character_id": 2, "attack_index": 0 }
```

## Flujo de Combate

1. El dueño de la mesa llama a `POST /combat/start`
2. El sistema tira iniciativa para cada jugador (d20 + mod DEX)
3. Se ordena de mayor a menor iniciativa
4. En cada turno, el jugador activo puede:
   - **Atacar**: se tira d20 + bonus del arma. Si `total >= CA del defensor` → impacta → se tira daño → se descuenta de HP
   - **Pasar**: no hace nada, pasa al siguiente
5. Cuando un personaje llega a 0 HP, queda "caído"
6. El dueño puede terminar el combate cuando quiera

## Desarrollo local

```bash
npm install
npm run dev    # con hot reload
# o
npm start      # sin hot reload
```

El servidor arranca en `http://localhost:3001`
