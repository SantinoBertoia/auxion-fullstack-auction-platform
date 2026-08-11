const test = require('node:test');

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test('integration tests require TEST_DATABASE_URL', { skip: 'Set TEST_DATABASE_URL to run PostgreSQL integration tests.' }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DATABASE_SSL = process.env.DATABASE_SSL || 'false';
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'integration-test-secret-with-at-least-32-chars';
  }
  process.env.ALLOW_DB_RESET = 'true';
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:19006,http://localhost:8081';
  process.env.ENABLE_REGISTRATION_REVIEW_JOB = 'false';
  process.env.MAIL_TRANSPORT = 'console';

  const assert = require('node:assert/strict');
  const { Pool } = require('pg');
  const request = require('supertest');

  const { createApp } = require('../../server');
  const { initializeDatabase, getDatabase } = require('../../src/db/database');
  const { resetAndSeed } = require('../../src/db/seed');

  const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

  const ensureDatabaseExists = async (databaseUrl) => {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.replace(/^\//, '');
    if (!databaseName) return;

    const maintenanceUrl = new URL(databaseUrl);
    maintenanceUrl.pathname = '/postgres';
    const pool = new Pool({
      connectionString: maintenanceUrl.toString(),
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    try {
      const existing = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
      if (existing.rowCount === 0) {
        await pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      }
    } finally {
      await pool.end();
    }
  };

  const app = createApp();

  const login = async (email = 'juan@email.com') => {
    const response = await request(app)
      .post('/api/usuarios/login')
      .send({ email, password: '123456' })
      .expect(200);
    return response.body.token;
  };

  const firstOpenAuction = async () => {
    const response = await request(app).get('/api/subastas').expect(200);
    return response.body.auctions.find((auction) => auction.estado === 'abierta' && auction.categoria === 'plata');
  };

  const enterAndGetRoom = async (token, auctionId) => {
    await request(app).post(`/api/subastas/${auctionId}/ingresar`).set('Authorization', `Bearer ${token}`).expect(200);
    const response = await request(app)
      .get(`/api/subastas/${auctionId}/estado`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body;
  };

  const firstCompatiblePayment = async (token, currency = 'USD') => {
    const response = await request(app).get('/api/usuarios/me/pagos').set('Authorization', `Bearer ${token}`).expect(200);
    return response.body.payments.find((payment) => payment.moneda === currency && Number(payment.verificado) === 1);
  };

  const installBidInsertDelay = async (db) => {
    await db.exec(`
      CREATE OR REPLACE FUNCTION test_sleep_before_bid_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM pg_sleep(0.35);
        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS test_sleep_before_bid_insert ON pujos;
      CREATE TRIGGER test_sleep_before_bid_insert
      BEFORE INSERT ON pujos
      FOR EACH ROW EXECUTE FUNCTION test_sleep_before_bid_insert();
    `);
  };

  const removeBidInsertDelay = async (db) => {
    await db.exec(`
      DROP TRIGGER IF EXISTS test_sleep_before_bid_insert ON pujos;
      DROP FUNCTION IF EXISTS test_sleep_before_bid_insert();
    `);
  };

  const waitForBidLockContention = async (db, timeoutMs = 1500) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS waiting
           FROM pg_stat_activity
           WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%FOR UPDATE OF ic%'`
        )
        .get();
      if (Number(row.waiting) > 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };

  test.before(async () => {
    await ensureDatabaseExists(testDatabaseUrl);
  });

  test.beforeEach(async () => {
    await initializeDatabase();
    await resetAndSeed(getDatabase());
  });

  test.after(async () => {
    await getDatabase().close();
  });

  test('healthcheck verifies PostgreSQL availability', async () => {
    const response = await request(app).get('/api/health').expect(200);

    assert.equal(response.body.ok, true);
    assert.equal(response.body.database, 'connected');
  });

  test('login succeeds with demo credentials and rejects invalid credentials', async () => {
    const ok = await request(app)
      .post('/api/usuarios/login')
      .send({ email: 'juan@email.com', password: '123456' })
      .expect(200);
    assert.ok(ok.body.token);

    await request(app)
      .post('/api/usuarios/login')
      .send({ email: 'juan@email.com', password: 'wrong-password' })
      .expect(401);
  });

  test('protected endpoints require JWT and accept valid JWT', async () => {
    await request(app).get('/api/usuarios/me/perfil').expect(401);

    const token = await login();
    const response = await request(app)
      .get('/api/usuarios/me/perfil')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(response.body.profile.email, 'juan@email.com');
  });

  test('back-office endpoints require an authenticated employee JWT', async () => {
    await request(app).patch('/api/usuarios/pagos/1/verificacion').send({ estado: 'verificado' }).expect(401);

    const clientToken = await login('juan@email.com');
    await request(app)
      .patch('/api/usuarios/pagos/1/verificacion')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ estado: 'verificado' })
      .expect(403);

    const employeeToken = await login('backoffice@auxion.local');
    const response = await request(app)
      .patch('/api/usuarios/pagos/1/verificacion')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ estado: 'verificado' })
      .expect(200);

    assert.equal(response.body.payment.verificado, 1);
  });

  test('password recovery works locally with console email and one-use tokens', async () => {
    const unknown = await request(app)
      .post('/api/usuarios/recuperar-password')
      .send({ email: 'missing@example.com' })
      .expect(200);
    assert.match(unknown.body.message, /Si existe una cuenta/);

    await request(app).post('/api/usuarios/recuperar-password').send({ email: 'juan@email.com' }).expect(200);

    const db = getDatabase();
    const reset = await db
      .prepare(
        `SELECT token
         FROM app_password_resets
         WHERE lower(email) = lower(?)
         ORDER BY identificador DESC
         LIMIT 1`
      )
      .get('juan@email.com');
    assert.ok(reset?.token);

    await request(app)
      .post('/api/usuarios/restablecer-password')
      .send({
        email: 'juan@email.com',
        token: reset.token,
        password: '654321',
        confirmPassword: '654321',
      })
      .expect(200);

    await request(app)
      .post('/api/usuarios/restablecer-password')
      .send({
        email: 'juan@email.com',
        token: reset.token,
        password: 'abcdef',
        confirmPassword: 'abcdef',
      })
      .expect(409);

    await request(app)
      .post('/api/usuarios/login')
      .send({ email: 'juan@email.com', password: '654321' })
      .expect(200);
  });

  test('new payment methods are stored and returned with masked references', async () => {
    const token = await login('juan@email.com');

    const created = await request(app)
      .post('/api/usuarios/me/pagos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'cuenta_bancaria',
        alias: 'Cuenta demo auditada',
        moneda: 'ARS',
        numero: '1234567890',
        banco: 'Banco Demo',
      })
      .expect(201);

    assert.equal(created.body.payment.numero, 'Account ending 7890');

    const db = getDatabase();
    const raw = await db
      .prepare('SELECT numero FROM "app_mediosPago" WHERE identificador = ?')
      .get(created.body.payment.id);

    assert.equal(raw.numero, 'Account ending 7890');
  });

  test('auction list is readable and contains demo auctions', async () => {
    const response = await request(app).get('/api/subastas').expect(200);

    assert.ok(response.body.auctions.length >= 3);
    assert.ok(response.body.auctions.some((auction) => auction.estado === 'abierta'));
  });

  test('valid and invalid bids are handled without partial records', async () => {
    const token = await login('juan@email.com');
    const auction = await firstOpenAuction();
    const room = await enterAndGetRoom(token, auction.id);
    const payment = await firstCompatiblePayment(token, room.auction.moneda);

    const validBid = await request(app)
      .post(`/api/subastas/${auction.id}/pujar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lote_id: room.currentLot.id, medio_pago_id: payment.id, monto: 10100 })
      .expect(201);
    assert.equal(validBid.body.monto, 10100);

    const anaToken = await login('ana@email.com');
    await enterAndGetRoom(anaToken, auction.id);
    const anaPayment = await firstCompatiblePayment(anaToken, room.auction.moneda);

    await request(app)
      .post(`/api/subastas/${auction.id}/pujar`)
      .set('Authorization', `Bearer ${anaToken}`)
      .send({ lote_id: room.currentLot.id, medio_pago_id: anaPayment.id, monto: 10150 })
      .expect(400);

    const db = getDatabase();
    const counts = await db
      .prepare(
        `SELECT COUNT(*) AS bids,
          (SELECT COUNT(*) FROM "app_pujaMedioPago" apmp
           JOIN pujos pj ON pj.identificador = apmp.pujo
           WHERE pj.item = ?) AS payment_links
         FROM pujos
         WHERE item = ?`
      )
      .get(room.currentLot.id, room.currentLot.id);

    assert.equal(counts.bids, 1);
    assert.equal(counts.payment_links, 1);
  });

  test('transaction rollback removes partial bid data when an intermediate operation fails', async () => {
    const token = await login('juan@email.com');
    const auction = await firstOpenAuction();
    const room = await enterAndGetRoom(token, auction.id);
    const db = getDatabase();
    const assistant = await db
      .prepare('SELECT identificador FROM asistentes WHERE cliente = ? AND subasta = ?')
      .get(4, auction.id);

    const before = await db.prepare('SELECT COUNT(*) AS total FROM pujos WHERE item = ?').get(room.currentLot.id);

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx
          .prepare('INSERT INTO pujos (asistente, item, importe) VALUES (?, ?, ?) RETURNING "identificador"')
          .run(assistant.identificador, room.currentLot.id, 10100);
        throw new Error('forced rollback');
      }),
      /forced rollback/
    );

    const after = await db.prepare('SELECT COUNT(*) AS total FROM pujos WHERE item = ?').get(room.currentLot.id);
    assert.equal(after.total, before.total);
  });

  test('concurrent bids on the same lot are serialized and preserve the best offer', async () => {
    const juanToken = await login('juan@email.com');
    const anaToken = await login('ana@email.com');
    const auction = await firstOpenAuction();
    const room = await enterAndGetRoom(juanToken, auction.id);
    await enterAndGetRoom(anaToken, auction.id);
    const juanPayment = await firstCompatiblePayment(juanToken, room.auction.moneda);
    const anaPayment = await firstCompatiblePayment(anaToken, room.auction.moneda);

    const db = getDatabase();
    await installBidInsertDelay(db);

    let lower;
    let higher;
    let lockContentionObserved = false;
    try {
      const lowerRequest = request(app)
        .post(`/api/subastas/${auction.id}/pujar`)
        .set('Authorization', `Bearer ${juanToken}`)
        .send({ lote_id: room.currentLot.id, medio_pago_id: juanPayment.id, monto: 10100 })
        .then((response) => response);

      await new Promise((resolve) => setTimeout(resolve, 75));

      const higherRequest = request(app)
        .post(`/api/subastas/${auction.id}/pujar`)
        .set('Authorization', `Bearer ${anaToken}`)
        .send({ lote_id: room.currentLot.id, medio_pago_id: anaPayment.id, monto: 10200 })
        .then((response) => response);

      lockContentionObserved = await waitForBidLockContention(db);
      [lower, higher] = await Promise.all([lowerRequest, higherRequest]);
    } finally {
      await removeBidInsertDelay(db);
    }

    assert.equal(lockContentionObserved, true);
    assert.equal(lower.status, 201);
    assert.equal(higher.status, 201);

    const best = await db
      .prepare(
        `SELECT pj.importe AS monto, a.cliente AS cliente
         FROM pujos pj
         JOIN asistentes a ON a.identificador = pj.asistente
         WHERE pj.item = ?
         ORDER BY pj.importe DESC, pj.identificador DESC
         LIMIT 1`
      )
      .get(room.currentLot.id);

    const consistency = await db
      .prepare(
        `SELECT COUNT(*) AS bids,
          (SELECT COUNT(*) FROM "app_pujaMedioPago" apmp
           JOIN pujos pj ON pj.identificador = apmp.pujo
           WHERE pj.item = ?) AS payment_links
         FROM pujos
         WHERE item = ?`
      )
      .get(room.currentLot.id, room.currentLot.id);

    assert.equal(best.monto, 10200);
    assert.equal(best.cliente, 5);
    assert.equal(consistency.bids, 2);
    assert.equal(consistency.payment_links, 2);
  });
}
