const crypto = require('crypto');

const { insertMensaje } = require('../db/repository');
const {
  sendPreRegistrationApprovedEmail,
  sendPreRegistrationReceivedEmail,
} = require('./emailService');
const { env } = require('../config/env');
const { categoryOrder } = require('../utils/businessRules');

const DEFAULT_REVIEW_MINUTES = 30;
const DEFAULT_REVIEW_JOB_INTERVAL_MS = 60 * 1000;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const nowIso = () => new Date().toISOString();

const getReviewMinutes = () => {
  return env.REGISTRATION_REVIEW_MINUTES ?? DEFAULT_REVIEW_MINUTES;
};

const getReviewAvailableAt = () => new Date(Date.now() + getReviewMinutes() * 60 * 1000).toISOString();

const isAutoVerifyPaymentForDemo = () => env.AUTO_VERIFY_PAYMENT_FOR_DEMO;

const assignRegistrationCategory = () => categoryOrder[Math.floor(Math.random() * categoryOrder.length)];

const runAsyncTransaction = async (db, work) => db.transaction(async (tx) => work(tx));

const createUniqueRegistrationToken = async (db) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = `AUX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const exists = await db.prepare('SELECT 1 FROM app_pre_registros WHERE "tokenRegistro" = ?').get(token);
    if (!exists) return token;
  }
  throw new Error('No se pudo generar un token de registro unico');
};

const getPreRegistrationById = (db, id) =>
  db
    .prepare(
      `SELECT
         pr.identificador AS id,
         pr.persona AS persona,
         pr.cliente AS cliente,
         pr.email AS email,
         pr."imagenDniFrente" AS "imagenDniFrente",
         pr."imagenDniDorso" AS "imagenDniDorso",
         pr.estado AS estado,
         pr."creadoEn" AS "creadoEn",
         pr."actualizadoEn" AS "actualizadoEn",
         pr."verificacionDisponibleEn" AS "verificacionDisponibleEn",
         pr."categoriaAsignada" AS "categoriaAsignada",
         pr."tokenRegistro" AS "tokenRegistro",
         pr."tokenExpiraEn" AS "tokenExpiraEn",
         pr."aprobadoEn" AS "aprobadoEn",
         pr."completadoEn" AS "completadoEn",
         p.nombre AS nombre,
         p.documento AS documento,
         p.direccion AS domicilio
       FROM app_pre_registros pr
       JOIN personas p ON p.identificador = pr.persona
       WHERE pr.identificador = ?`
    )
    .get(id);

const getPreRegistrationByEmail = (db, email) =>
  db
    .prepare(
      `SELECT
         pr.identificador AS id,
         pr.persona AS persona,
         pr.cliente AS cliente,
         pr.email AS email,
         pr."imagenDniFrente" AS "imagenDniFrente",
         pr."imagenDniDorso" AS "imagenDniDorso",
         pr.estado AS estado,
         pr."creadoEn" AS "creadoEn",
         pr."actualizadoEn" AS "actualizadoEn",
         pr."verificacionDisponibleEn" AS "verificacionDisponibleEn",
         pr."categoriaAsignada" AS "categoriaAsignada",
         pr."tokenRegistro" AS "tokenRegistro",
         pr."tokenExpiraEn" AS "tokenExpiraEn",
         pr."aprobadoEn" AS "aprobadoEn",
         pr."completadoEn" AS "completadoEn",
         p.nombre AS nombre,
         p.documento AS documento,
         p.direccion AS domicilio
       FROM app_pre_registros pr
       JOIN personas p ON p.identificador = pr.persona
       WHERE lower(pr.email) = lower(?)
       ORDER BY pr.identificador DESC
       LIMIT 1`
    )
    .get(email);

const getPreRegistrationByToken = (db, token) =>
  db
    .prepare(
      `SELECT
         pr.identificador AS id,
         pr.persona AS persona,
         pr.cliente AS cliente,
         pr.email AS email,
         pr."imagenDniFrente" AS "imagenDniFrente",
         pr."imagenDniDorso" AS "imagenDniDorso",
         pr.estado AS estado,
         pr."creadoEn" AS "creadoEn",
         pr."actualizadoEn" AS "actualizadoEn",
         pr."verificacionDisponibleEn" AS "verificacionDisponibleEn",
         pr."categoriaAsignada" AS "categoriaAsignada",
         pr."tokenRegistro" AS "tokenRegistro",
         pr."tokenExpiraEn" AS "tokenExpiraEn",
         pr."aprobadoEn" AS "aprobadoEn",
         pr."completadoEn" AS "completadoEn",
         p.nombre AS nombre,
         p.documento AS documento,
         p.direccion AS domicilio
       FROM app_pre_registros pr
       JOIN personas p ON p.identificador = pr.persona
       WHERE pr."tokenRegistro" = ?
       LIMIT 1`
    )
    .get(token);

const publicPreRegistration = (pre) => {
  if (!pre) return null;
  return {
    id: pre.id,
    email: pre.email,
    estado: pre.estado,
    nombre: pre.nombre,
    creadoEn: pre.creadoEn,
    verificacionDisponibleEn: pre.verificacionDisponibleEn,
    categoriaAsignada: pre.categoriaAsignada || null,
    aprobadoEn: pre.aprobadoEn || null,
    completadoEn: pre.completadoEn || null,
  };
};

const notifyRegistrationReceived = async (db, pre) => {
  await sendPreRegistrationReceivedEmail({
    to: pre.email,
    nombre: pre.nombre,
    reviewAvailableAt: pre.verificacionDisponibleEn,
  });
  insertMensaje(
    db,
    pre.persona,
    'Solicitud recibida',
    'Tu solicitud de registro fue recibida. La empresa evaluara tus datos antes de habilitar tu cuenta.',
    'mensaje'
  );
};

const notifyRegistrationApproved = async (db, pre) => {
  await sendPreRegistrationApprovedEmail({
    to: pre.email,
    nombre: pre.nombre,
    categoria: pre.categoriaAsignada,
    tokenRegistro: pre.tokenRegistro,
  });
  insertMensaje(
    db,
    pre.persona,
    'Cuenta aprobada',
    `Tu cuenta fue aprobada con categoria ${pre.categoriaAsignada}. Completa el registro con el codigo ${pre.tokenRegistro}.`,
    'alerta'
  );
};

const approvePreRegistration = async (db, pre, preferredCategory) => {
  if (!pre || pre.estado === 'completado') return pre;

  const wasAlreadyApproved = pre.estado === 'aprobado';
  if (wasAlreadyApproved && pre.tokenRegistro) {
    return (await getPreRegistrationById(db, pre.id)) || pre;
  }

  const category = preferredCategory || pre.categoriaAsignada || assignRegistrationCategory();
  const token = pre.tokenRegistro || (await createUniqueRegistrationToken(db));
  const approvedAt = pre.aprobadoEn || nowIso();

  return db.transaction(async (tx) => {
    await tx.prepare("UPDATE clientes SET admitido = 'si', categoria = ? WHERE identificador = ?").run(category, pre.cliente);
    await tx.prepare(
      `UPDATE app_pre_registros
       SET estado = 'aprobado',
           "categoriaAsignada" = ?,
           "tokenRegistro" = ?,
           "actualizadoEn" = ?,
           "aprobadoEn" = ?
       WHERE identificador = ?`
    ).run(category, token, nowIso(), approvedAt, pre.id);

    const updated = await getPreRegistrationById(tx, pre.id);
    await notifyRegistrationApproved(tx, updated);
    return updated;
  });
};

const rejectPreRegistration = async (db, pre) => {
  if (!pre || pre.estado === 'completado') return pre;
  await db.prepare("UPDATE clientes SET admitido = 'no' WHERE identificador = ?").run(pre.cliente);
  await db.prepare(
    `UPDATE app_pre_registros
     SET estado = 'rechazado', "actualizadoEn" = ?
     WHERE identificador = ?`
  ).run(nowIso(), pre.id);
  insertMensaje(
    db,
    pre.persona,
    'Solicitud rechazada',
    'La empresa no pudo aprobar tu solicitud de registro. Contacta a Auxion para mas informacion.',
    'alerta'
  );
  return getPreRegistrationById(db, pre.id);
};

const processDuePreRegistrations = async (db, email) => {
  const current = nowIso();
  const params = email ? [normalizeEmail(email), current] : [current];
  const whereEmail = email ? 'AND lower(email) = lower(?)' : '';
  const rows = await db
    .prepare(
      `SELECT
         identificador AS id,
         persona,
         cliente,
         email,
         estado,
         "verificacionDisponibleEn" AS "verificacionDisponibleEn",
         "categoriaAsignada" AS "categoriaAsignada",
         "tokenRegistro" AS "tokenRegistro",
         "aprobadoEn" AS "aprobadoEn"
       FROM app_pre_registros
       WHERE estado = 'pendiente'
         ${whereEmail}
         AND "verificacionDisponibleEn" <= ?
       ORDER BY identificador ASC`
    )
    .all(...params);

  if (rows.length === 0) return [];

  const processed = [];
  for (const pre of rows) {
    processed.push(await approvePreRegistration(db, pre));
  }
  return processed;
};

const startRegistrationReviewJob = (db, intervalMs = DEFAULT_REVIEW_JOB_INTERVAL_MS) => {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const processed = await processDuePreRegistrations(db);
      if (processed.length > 0) {
        console.log(`Preregistros aprobados automaticamente: ${processed.length}`);
      }
    } catch (error) {
      console.error(`No se pudieron procesar preregistros pendientes: ${error.message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  run();
  return timer;
};

module.exports = {
  normalizeEmail,
  runAsyncTransaction,
  getReviewMinutes,
  getReviewAvailableAt,
  isAutoVerifyPaymentForDemo,
  assignRegistrationCategory,
  getPreRegistrationByEmail,
  getPreRegistrationByToken,
  publicPreRegistration,
  notifyRegistrationReceived,
  approvePreRegistration,
  rejectPreRegistration,
  processDuePreRegistrations,
  startRegistrationReviewJob,
};
