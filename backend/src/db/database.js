const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const { env } = require('../config/env');

// pg devuelve algunos tipos como string para no perder precision. Para conservar
// el comportamiento de better-sqlite3 (numeros JS) los parseamos a Number:
//   20   = int8 / bigint  -> lo que devuelve COUNT(*)
//   1700 = numeric
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

const schemaPath = path.join(__dirname, 'schema.sql');

let pool;

const getPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
      max: env.PG_POOL_MAX,
    });
  }
  return pool;
};

// Traduce los placeholders estilo SQLite (?) a los de Postgres ($1, $2, ...).
const toPg = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${(index += 1)}`);
};

// Acepta tanto .run(a, b, c) como .run([a, b, c]).
const normalizeParams = (params) =>
  params.length === 1 && Array.isArray(params[0]) ? params[0] : params;

// Reconstruye la API estilo better-sqlite3 (prepare().get/all/run) sobre un
// "ejecutor": el pool para queries sueltas, o un client unico dentro de una tx.
const makeApi = (exec) => ({
  prepare(sql) {
    const text = toPg(sql);
    return {
      get: async (...params) => {
        const res = await exec(text, normalizeParams(params));
        return res.rows[0];
      },
      all: async (...params) => {
        const res = await exec(text, normalizeParams(params));
        return res.rows;
      },
      run: async (...params) => {
        const res = await exec(text, normalizeParams(params));
        // lastInsertRowid solo viene si el INSERT incluye RETURNING "identificador".
        const lastInsertRowid = res.rows[0] ? res.rows[0].identificador : undefined;
        return { changes: res.rowCount, rowCount: res.rowCount, lastInsertRowid };
      },
    };
  },
});

// Ejecuta `fn` dentro de una transaccion. `fn` recibe una API igual a la del db
// pero atada a un unico client (en pg el pool da una conexion distinta por query,
// asi que BEGIN/COMMIT tienen que correr sobre el mismo client).
const transaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const txApi = makeApi((text, params) => client.query(text, params));
    const result = await fn(txApi);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

let db;

const getDatabase = () => {
  if (!db) {
    const api = makeApi((text, params) => getPool().query(text, params));
    db = {
      prepare: api.prepare,
      // Uso: await db.transaction(async (tx) => { await tx.prepare(...).run(...); })
      transaction,
      // DDL multi-sentencia (sin placeholders).
      exec: async (sql) => {
        await getPool().query(sql);
      },
      close: async () => {
        if (pool) {
          await pool.end();
          pool = undefined;
        }
      },
    };
  }
  return db;
};

// Crea el esquema si no existe (idempotente). Asi la app es autosuficiente:
// apuntando DATABASE_URL a una base PostgreSQL vacia, arranca y crea sus tablas.
const initializeDatabase = async () => {
  const database = getDatabase();
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await database.exec(schema);
  return database;
};

module.exports = {
  getDatabase,
  initializeDatabase,
};
