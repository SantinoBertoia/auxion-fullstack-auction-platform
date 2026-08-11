const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { getDatabase } = require('../db/database');
const { JWT_SECRET, requireAuth, requireBackoffice } = require('../middleware/auth');
const {
  loadUserByEmail,
  loadUserByPersonaId,
  getPasswordHash,
  publicUser,
  listMediosPago,
  getPublicMedioPago,
  maskPaymentNumber,
  publicPayment,
  insertMensaje,
  listMensajes,
} = require('../db/repository');
const { ESTADO_SUBASTA_CERRADA, categoryOrder } = require('../utils/businessRules');
const { validatePaymentPayload } = require('../utils/paymentRules');
const {
  normalizeEmail,
  runAsyncTransaction,
  getReviewMinutes,
  getReviewAvailableAt,
  isAutoVerifyPaymentForDemo,
  getPreRegistrationByEmail,
  getPreRegistrationByToken,
  publicPreRegistration,
  notifyRegistrationReceived,
  approvePreRegistration,
  rejectPreRegistration,
  processDuePreRegistrations,
} = require('../services/registrationFlow');
const { sendPasswordResetEmail } = require('../services/emailService');
const { env } = require('../config/env');

const router = express.Router();

const USER_ARTICLE_FIELDS = `identificador AS id, titulo, descripcion, "imagenFrente" AS "imagenFrente",
  "imagenDorso" AS "imagenDorso", "precioEstimado" AS "precioEstimado", estado,
  "condicionesVenta" AS "condicionesVenta", "creadoEn" AS "createdAt"`;
const PAYMENT_VERIFICATION_STATES = {
  pendiente: 0,
  verificado: 1,
  rechazado: -1,
};

const normalizePaymentVerificationState = (value) => {
  if (value === true || value === 1) return 'verificado';
  if (value === false || value === 0) return 'pendiente';
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAYMENT_VERIFICATION_STATES, normalized) ? normalized : null;
};

const isEmailDeliveryError = (error) =>
  error && (error.code === 'SMTP_NOT_CONFIGURED' || error.code === 'SMTP_SEND_FAILED');

const respondEmailDeliveryError = (res, error) =>
  res.status(error.status || 502).json({
    code: error.code || 'SMTP_SEND_FAILED',
    message: error.message,
  });

const buildRegistrationStateResponse = (pre) => {
  if (!pre) return null;

  if (pre.estado === 'pendiente') {
    return {
      status: 403,
      code: 'REGISTRATION_PENDING',
      message: 'Tu solicitud esta pendiente de verificacion por la empresa.',
      preRegistro: publicPreRegistration(pre),
    };
  }

  if (pre.estado === 'aprobado') {
    return {
      status: 409,
      code: 'REGISTRATION_INCOMPLETE',
      message: 'Tu solicitud fue aprobada. Completa el registro con el codigo enviado por email.',
      preRegistro: publicPreRegistration(pre),
    };
  }

  if (pre.estado === 'rechazado') {
    return {
      status: 403,
      code: 'REGISTRATION_REJECTED',
      message: 'La solicitud fue rechazada por la empresa.',
      preRegistro: publicPreRegistration(pre),
    };
  }

  return {
    status: 409,
    code: 'REGISTRATION_ALREADY_COMPLETED',
    message: 'El registro ya fue completado. Inicia sesion con tu email y contrasena.',
    preRegistro: publicPreRegistration(pre),
  };
};

const DEFAULT_PASSWORD_RESET_MINUTES = 30;
const PASSWORD_RESET_ACCEPTED_MESSAGE =
  'Si existe una cuenta para ese email, te enviaremos un codigo de recuperacion.';

const getPasswordResetMinutes = () => {
  return env.PASSWORD_RESET_TOKEN_MINUTES ?? DEFAULT_PASSWORD_RESET_MINUTES;
};

const createPasswordResetExpiresAt = () =>
  new Date(Date.now() + getPasswordResetMinutes() * 60 * 1000).toISOString();

const createUniquePasswordResetToken = async (db) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = `REC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const exists = await db.prepare('SELECT 1 FROM app_password_resets WHERE token = ?').get(token);
    if (!exists) return token;
  }
  throw new Error('No se pudo generar un token de recuperacion unico');
};

const findPasswordReset = (db, email, token) =>
  db
    .prepare(
      `SELECT identificador AS id, persona, email, token, "creadoEn", "expiraEn", "usadoEn"
       FROM app_password_resets
       WHERE lower(email) = lower(?) AND token = ?
       ORDER BY identificador DESC
       LIMIT 1`
    )
    .get(email, token);

const insertPayment = async (db, clienteId, payment) => {
  const verificado = isAutoVerifyPaymentForDemo() ? 1 : 0;
  const storedPaymentNumber = payment.numero ? maskPaymentNumber(payment.numero, payment.tipo) : null;
  const result = await db
    .prepare(
      `INSERT INTO "app_mediosPago" (cliente, tipo, alias, moneda, numero, banco, "montoGarantia", verificado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING "identificador"`
    )
    .run(
      clienteId,
      payment.tipo,
      payment.alias,
      payment.moneda,
      storedPaymentNumber,
      payment.banco || null,
      payment.montoGarantia || null,
      verificado
    );

  return getPublicMedioPago(db, result.lastInsertRowid, clienteId);
};

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email) {
    return res.status(422).json({ message: 'Email es obligatorio' });
  }
  if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
    return res.status(422).json({ message: 'Email invalido' });
  }

  const db = getDatabase();
  try {
    await processDuePreRegistrations(db, email);
  } catch (error) {
    if (isEmailDeliveryError(error)) {
      return respondEmailDeliveryError(res, error);
    }
    throw error;
  }

  const user = await loadUserByEmail(db, email);
  if (!user) {
    const pre = await getPreRegistrationByEmail(db, email);
    const stateResponse = buildRegistrationStateResponse(pre);
    if (stateResponse) {
      return res.status(stateResponse.status).json({
        code: stateResponse.code,
        message: stateResponse.message,
        preRegistro: stateResponse.preRegistro,
      });
    }
    if (!password) {
      return res.status(422).json({ message: 'Email y contrasena son obligatorios' });
    }
    return res.status(401).json({ message: 'Credenciales incorrectas' });
  }

  if (!password) {
    return res.status(422).json({ message: 'Email y contrasena son obligatorios' });
  }

  // personas.estado = 'inactivo' => cuenta inhabilitada, no puede ingresar.
  if (user.blocked) {
    return res.status(403).json({
      code: 'ACCOUNT_DISABLED',
      message: 'La cuenta esta inhabilitada. Contacte a la empresa.',
    });
  }

  const hash = await getPasswordHash(db, user.id);
  if (!hash || !bcrypt.compareSync(password, hash)) {
    return res.status(401).json({ message: 'Credenciales incorrectas' });
  }

  if (user.estadoPreRegistro === 'rechazado') {
    return res.status(403).json({
      code: 'REGISTRATION_REJECTED',
      message: 'La solicitud fue rechazada por la empresa.',
      user: await publicUser(db, user),
    });
  }

  if (user.esCliente && user.admitido !== 'si') {
    return res.status(403).json({
      code: 'REGISTRATION_PENDING',
      message: 'Tu solicitud esta pendiente de verificacion por la empresa.',
      user: await publicUser(db, user),
    });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
  return res.json({ token, user: await publicUser(db, user) });
});

router.post('/recuperar-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(422).json({ message: 'Email es obligatorio' });
  }
  if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
    return res.status(422).json({ message: 'Email invalido' });
  }

  const db = getDatabase();
  const normalizedEmail = normalizeEmail(email);
  const user = await loadUserByEmail(db, normalizedEmail);
  if (!user) {
    return res.json({ message: PASSWORD_RESET_ACCEPTED_MESSAGE });
  }

  const resetToken = await createUniquePasswordResetToken(db);
  const expiresAt = createPasswordResetExpiresAt();
  const now = new Date().toISOString();

  try {
    await runAsyncTransaction(db, async (tx) => {
      await tx.prepare('UPDATE app_password_resets SET "usadoEn" = ? WHERE persona = ? AND "usadoEn" IS NULL')
        .run(now, user.id);
      await tx.prepare(
        `INSERT INTO app_password_resets (persona, email, token, "expiraEn")
         VALUES (?, ?, ?, ?)`
      ).run(user.id, normalizedEmail, resetToken, expiresAt);

      await sendPasswordResetEmail({
        to: normalizedEmail,
        nombre: user.nombre,
        token: resetToken,
        expiresAt,
      });
    });
  } catch (error) {
    if (isEmailDeliveryError(error)) {
      console.warn(`Password reset email delivery failed: ${error.code || error.message}`);
      return res.json({ message: PASSWORD_RESET_ACCEPTED_MESSAGE });
    }
    throw error;
  }

  return res.json({
    message: PASSWORD_RESET_ACCEPTED_MESSAGE,
  });
});

router.post('/restablecer-password', async (req, res) => {
  const { email, token, password, confirmPassword } = req.body;

  if (!email || !token || !password || !confirmPassword) {
    return res.status(422).json({ message: 'Email, codigo y nueva contrasena son obligatorios' });
  }
  if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
    return res.status(422).json({ message: 'Email invalido' });
  }
  if (String(password).length < 6) {
    return res.status(422).json({ message: 'La contrasena debe tener al menos 6 caracteres' });
  }
  if (password !== confirmPassword) {
    return res.status(422).json({ message: 'Las contrasenas no coinciden' });
  }

  const db = getDatabase();
  const normalizedEmail = normalizeEmail(email);
  const reset = await findPasswordReset(db, normalizedEmail, String(token).trim().toUpperCase());
  if (!reset) {
    return res.status(404).json({ message: 'Codigo de recuperacion invalido' });
  }
  if (reset.usadoEn) {
    return res.status(409).json({ message: 'El codigo de recuperacion ya fue usado' });
  }
  if (new Date(reset.expiraEn).getTime() < Date.now()) {
    return res.status(410).json({ message: 'El codigo de recuperacion expiro' });
  }

  await db.transaction(async (tx) => {
    const hash = bcrypt.hashSync(password, 10);
    await tx.prepare('UPDATE app_credenciales SET "passwordHash" = ? WHERE persona = ? AND lower(email) = lower(?)')
      .run(hash, reset.persona, normalizedEmail);
    await tx.prepare('UPDATE app_password_resets SET "usadoEn" = ? WHERE identificador = ?')
      .run(new Date().toISOString(), reset.id);
  });

  return res.json({
    message: 'Contrasena actualizada correctamente. Ya podes iniciar sesion.',
  });
});

router.get('/me/perfil', requireAuth, async (req, res) => {
  const db = getDatabase();
  return res.json({ profile: await publicUser(db, req.user) });
});

router.get('/me/pagos', requireAuth, async (req, res) => {
  const db = getDatabase();
  return res.json({ payments: await listMediosPago(db, req.user.id) });
});

router.get('/me/articulos', requireAuth, async (req, res) => {
  const db = getDatabase();
  const articles = await db
    .prepare(`SELECT ${USER_ARTICLE_FIELDS} FROM app_articulos WHERE persona = ? ORDER BY "creadoEn" DESC`)
    .all(req.user.id);

  return res.json({ articles });
});

router.post('/me/pagos', requireAuth, async (req, res) => {
  if (!req.user.esCliente) {
    return res.status(403).json({ message: 'Solo los clientes pueden registrar medios de pago' });
  }

  const { payment, error } = validatePaymentPayload(req.body);
  if (error) {
    return res.status(422).json({ message: error });
  }

  const db = getDatabase();
  const savedPayment = await insertPayment(db, req.user.id, payment);
  const verifiedForDemo = Boolean(savedPayment.verificado);

  return res.status(201).json({
    message: verifiedForDemo
      ? 'Medio de pago registrado y verificado automaticamente para demo.'
      : 'Medio de pago registrado. Queda pendiente de verificacion.',
    payment: savedPayment,
  });
});

// PATCH /api/usuarios/pagos/:id/verificacion
// Back-office action: verify, reject or return a payment method to pending.
router.patch('/pagos/:id/verificacion', requireAuth, requireBackoffice, async (req, res) => {
  const estado = normalizePaymentVerificationState(req.body?.estado ?? req.body?.verificado);
  if (!estado) {
    return res.status(422).json({ message: 'estado debe ser pendiente, verificado o rechazado' });
  }

  const db = getDatabase();
  const payment = await db
    .prepare(
      `SELECT mp.identificador AS id, mp.cliente, mp.alias, mp.tipo, mp.moneda
       FROM "app_mediosPago" mp
       WHERE mp.identificador = ?`
    )
    .get(req.params.id);

  if (!payment) {
    return res.status(404).json({ message: 'Medio de pago no encontrado' });
  }

  await db.transaction(async (tx) => {
    await tx
      .prepare('UPDATE "app_mediosPago" SET verificado = ? WHERE identificador = ?')
      .run(PAYMENT_VERIFICATION_STATES[estado], payment.id);

    await insertMensaje(
      tx,
      payment.cliente,
      'Estado de medio de pago actualizado',
      `Tu medio de pago "${payment.alias || payment.tipo}" quedo en estado: ${estado}.`,
      'alerta'
    );
  });

  const updated = await db
    .prepare(
      `SELECT identificador AS id, tipo, alias, moneda, numero, banco,
        "montoGarantia" AS "montoGarantia", verificado, "creadoEn" AS "createdAt"
       FROM "app_mediosPago"
       WHERE identificador = ?`
    )
    .get(payment.id);

  return res.json({
    message: `Medio de pago ${estado}.`,
    payment: publicPayment(updated),
  });
});

router.get('/me/estadisticas', requireAuth, async (req, res) => {
  const db = getDatabase();
  const clienteId = req.user.id;

  const attended = (await db
    .prepare('SELECT COUNT(DISTINCT subasta) AS total FROM asistentes WHERE cliente = ?')
    .get(clienteId)).total;
  const offered = (await db
    .prepare(
      `SELECT COALESCE(SUM(pj.importe), 0) AS total
       FROM pujos pj JOIN asistentes a ON a.identificador = pj.asistente
       WHERE a.cliente = ?`
    )
    .get(clienteId)).total;
  const won = (await db.prepare('SELECT COUNT(*) AS total FROM "registroDeSubasta" WHERE cliente = ?').get(clienteId)).total;
  const paid = (await db
    .prepare('SELECT COALESCE(SUM(importe), 0) AS total FROM "registroDeSubasta" WHERE cliente = ?')
    .get(clienteId)).total;

  const wonAuctions = await db
    .prepare(
      `SELECT r.identificador AS id,
        (SELECT descripcion FROM catalogos WHERE subasta = s.identificador ORDER BY identificador ASC LIMIT 1) AS subasta,
        rt.moneda AS moneda,
        pr."descripcionCatalogo" AS lote, r.importe AS monto, NULL AS "createdAt"
       FROM "registroDeSubasta" r
       JOIN productos pr ON pr.identificador = r.producto
       JOIN subastas s ON s.identificador = r.subasta
       LEFT JOIN "app_subastaRuntime" rt ON rt.subasta = s.identificador
       WHERE r.cliente = ?
       ORDER BY r.identificador DESC`
    )
    .all(clienteId);

  const historyRows = await db
    .prepare(
      `SELECT pj.identificador AS id, pj.importe AS monto, pj.ganador AS "ganadorRaw",
        ic.subastado AS "subastadoRaw", cat.descripcion AS subasta,
        rt.moneda AS moneda, pr."descripcionCatalogo" AS lote,
        apmp."medioPago" AS "medio_pago_id", mp.alias AS "medio_pago_alias",
        mp.tipo AS "medio_pago_tipo"
       FROM pujos pj
       JOIN asistentes a ON a.identificador = pj.asistente
       JOIN "itemsCatalogo" ic ON ic.identificador = pj.item
       JOIN productos pr ON pr.identificador = ic.producto
       JOIN catalogos cat ON cat.identificador = ic.catalogo
       JOIN subastas s ON s.identificador = cat.subasta
       LEFT JOIN "app_subastaRuntime" rt ON rt.subasta = s.identificador
       LEFT JOIN "app_pujaMedioPago" apmp ON apmp.pujo = pj.identificador
       LEFT JOIN "app_mediosPago" mp ON mp.identificador = apmp."medioPago"
       WHERE a.cliente = ?
       ORDER BY pj.identificador DESC
       LIMIT 8`
    )
    .all(clienteId);

  const history = historyRows.map((row) => {
    let resultado = 'participando';
    if (row.ganadorRaw === 'si') resultado = 'ganada';
    else if (row.subastadoRaw === 'si') resultado = 'superada';
    return {
      id: row.id,
      monto: row.monto,
      createdAt: null,
      subasta: row.subasta,
      moneda: row.moneda || 'ARS',
      lote: row.lote,
      ganador: row.ganadorRaw === 'si' ? 1 : 0,
      resultado,
      medio_pago_id: row.medio_pago_id || null,
      medio_pago: row.medio_pago_id
        ? {
            id: row.medio_pago_id,
            alias: row.medio_pago_alias,
            tipo: row.medio_pago_tipo,
          }
        : null,
    };
  });

  const nowMs = Date.now();
  const participatingRows = await db
    .prepare(
      `SELECT DISTINCT s.identificador AS id,
        (SELECT descripcion FROM catalogos WHERE subasta = s.identificador ORDER BY identificador ASC LIMIT 1) AS titulo,
        s.estado AS "estadoRaw", rt.moneda AS moneda, rt."inicioProgramado" AS "inicioProgramado"
       FROM asistentes a
       JOIN subastas s ON s.identificador = a.subasta
       LEFT JOIN "app_subastaRuntime" rt ON rt.subasta = s.identificador
       WHERE a.cliente = ?`
    )
    .all(clienteId);

  const participating = participatingRows
    .filter((row) => row.estadoRaw !== ESTADO_SUBASTA_CERRADA)
    .map((row) => ({
      id: row.id,
      titulo: row.titulo,
      estado:
        row.inicioProgramado && nowMs < new Date(row.inicioProgramado).getTime() ? 'proxima' : 'abierta',
      moneda: row.moneda || 'ARS',
    }));

  const messages = await listMensajes(db, clienteId, 6);

  return res.json({
    metrics: {
      subastasAsistidas: attended,
      subastasGanadas: won,
      montoOfertado: offered,
      montoPagado: paid,
    },
    user: await publicUser(db, req.user),
    participating,
    wonAuctions,
    history,
    messages,
    alerts: messages.filter((message) => message.tipo === 'alerta'),
  });
});

// Resuelve el numero de pais (paises) a partir del nombre/nacionalidad recibido.
const resolvePais = async (db, pais) => {
  if (!pais) return null;
  const row = await db
    .prepare(
      `SELECT numero FROM paises
       WHERE lower(nombre) = lower(?) OR lower(nacionalidad) = lower(?) OR lower("nombreCorto") = lower(?)
       LIMIT 1`
    )
    .get(pais, pais, pais);
  return row ? row.numero : null;
};

router.get('/pre-registro/estado', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(422).json({ message: 'Email es obligatorio' });
  }

  const db = getDatabase();
  try {
    await processDuePreRegistrations(db, email);
  } catch (error) {
    if (isEmailDeliveryError(error)) {
      return respondEmailDeliveryError(res, error);
    }
    throw error;
  }

  const pre = await getPreRegistrationByEmail(db, email);
  if (!pre) {
    return res.status(404).json({ message: 'No se encontro una solicitud para ese email' });
  }

  return res.json({
    message:
      pre.estado === 'aprobado'
        ? 'Solicitud aprobada. Completa tu registro con el codigo enviado.'
        : 'Solicitud en revision.',
    preRegistro: publicPreRegistration(pre),
  });
});

router.post('/pre-registro', async (req, res) => {
  const {
    email,
    nombre,
    apellido,
    documento,
    domicilio,
    pais,
    imagenDniFrente,
    imagenDniDorso,
  } = req.body;

  if (!email || !nombre || !apellido || !documento || !domicilio || !pais || !imagenDniFrente || !imagenDniDorso) {
    return res.status(422).json({
      message: 'Email, nombre, apellido, documento, pais, domicilio y ambos lados del DNI son obligatorios',
    });
  }
  if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
    return res.status(422).json({ message: 'Email invalido' });
  }

  const db = getDatabase();
  try {
    await processDuePreRegistrations(db, email);
  } catch (error) {
    if (isEmailDeliveryError(error)) {
      return respondEmailDeliveryError(res, error);
    }
    throw error;
  }

  const normalizedEmail = normalizeEmail(email);
  const existingCredential = await db
    .prepare('SELECT persona FROM app_credenciales WHERE lower(email) = lower(?)')
    .get(normalizedEmail);
  if (existingCredential) {
    return res.status(409).json({ message: 'Ya existe una cuenta activa con ese email' });
  }

  const existingPre = await getPreRegistrationByEmail(db, normalizedEmail);
  if (existingPre) {
    const stateResponse = buildRegistrationStateResponse(existingPre);
    return res.status(stateResponse.status).json({
      code: stateResponse.code,
      message: stateResponse.message,
      preRegistro: stateResponse.preRegistro,
    });
  }

  const verificador = await db.prepare('SELECT identificador FROM empleados ORDER BY identificador ASC LIMIT 1').get();
  if (!verificador) {
    return res.status(500).json({ message: 'No hay verificador cargado para crear la solicitud' });
  }

  const nombreCompleto = `${String(nombre).trim()} ${String(apellido).trim()}`.trim();
  const numeroPais = await resolvePais(db, pais);
  const reviewAvailableAt = getReviewAvailableAt();

  let pre;
  try {
    pre = await runAsyncTransaction(db, async (tx) => {
    const persona = await tx
      .prepare("INSERT INTO personas (documento, nombre, direccion, estado) VALUES (?, ?, ?, 'activo') RETURNING \"identificador\"")
      .run(String(documento).trim(), nombreCompleto, String(domicilio).trim());
    const personaId = persona.lastInsertRowid;

    await tx.prepare(
      "INSERT INTO clientes (identificador, \"numeroPais\", admitido, categoria, verificador) VALUES (?, ?, 'no', 'comun', ?)"
    ).run(personaId, numeroPais, verificador.identificador);

    await tx
      .prepare(
        `INSERT INTO app_pre_registros
          (persona, cliente, email, "imagenDniFrente", "imagenDniDorso", estado, "verificacionDisponibleEn")
         VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`
      )
      .run(
        personaId,
        personaId,
        normalizedEmail,
        String(imagenDniFrente).trim(),
        String(imagenDniDorso).trim(),
        reviewAvailableAt
      );

    const pre = await getPreRegistrationByEmail(tx, normalizedEmail);
    if (!pre) {
      throw new Error('No se pudo recuperar el preregistro creado');
    }
    await notifyRegistrationReceived(tx, pre);
    return pre;
    });
  } catch (error) {
    if (isEmailDeliveryError(error)) {
      return respondEmailDeliveryError(res, error);
    }
    throw error;
  }

  return res.status(201).json({
    message: `Solicitud recibida. La investigacion externa se procesara en ${getReviewMinutes()} minutos.`,
    preRegistro: publicPreRegistration(pre),
  });
});

router.post('/confirmar-registro', async (req, res) => {
  const tokenRegistro = req.body.token_registro || req.body.tokenRegistro;
  const { password, confirmPassword, medioPago } = req.body;

  if (!tokenRegistro || !password) {
    return res.status(422).json({ message: 'Token de registro y contrasena son obligatorios' });
  }
  if (String(password).length < 6) {
    return res.status(422).json({ message: 'La contrasena debe tener al menos 6 caracteres' });
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(422).json({ message: 'Las contrasenas no coinciden' });
  }

  const db = getDatabase();
  try {
    await processDuePreRegistrations(db);
  } catch (error) {
    if (isEmailDeliveryError(error)) {
      return respondEmailDeliveryError(res, error);
    }
    throw error;
  }

  const pre = await getPreRegistrationByToken(db, String(tokenRegistro).trim());
  if (!pre) {
    return res.status(404).json({ message: 'Token de registro invalido' });
  }
  if (pre.tokenExpiraEn && new Date(pre.tokenExpiraEn).getTime() < Date.now()) {
    return res.status(410).json({ message: 'El token de registro expiro' });
  }
  if (pre.estado === 'pendiente') {
    return res.status(409).json({ message: 'La solicitud todavia esta pendiente de verificacion' });
  }
  if (pre.estado === 'rechazado') {
    return res.status(403).json({ message: 'La solicitud fue rechazada por la empresa' });
  }
  if (pre.estado === 'completado') {
    return res.status(409).json({ message: 'El registro ya fue completado. Inicia sesion.' });
  }

  if (!medioPago) {
    return res.status(422).json({ message: 'Debes cargar un medio de pago para completar el registro' });
  }

  const validation = validatePaymentPayload(medioPago);
  if (validation.error) {
    return res.status(422).json({ message: validation.error });
  }
  const normalizedPayment = validation.payment;

  const existingCredential = await db
    .prepare('SELECT persona FROM app_credenciales WHERE lower(email) = lower(?) OR persona = ?')
    .get(pre.email, pre.persona);
  if (existingCredential) {
    return res.status(409).json({ message: 'Ya existe una credencial activa para esta solicitud' });
  }

  const savedPayment = await db.transaction(async (tx) => {
    const hash = bcrypt.hashSync(password, 10);
    await tx.prepare('INSERT INTO app_credenciales (persona, email, "passwordHash") VALUES (?, ?, ?)')
      .run(pre.persona, pre.email, hash);
    await tx.prepare(
      `UPDATE app_pre_registros
       SET estado = 'completado', "actualizadoEn" = ?, "completadoEn" = ?
       WHERE identificador = ?`
    ).run(new Date().toISOString(), new Date().toISOString(), pre.id);

    const payment = await insertPayment(tx, pre.cliente, normalizedPayment);
    await insertMensaje(
      tx,
      pre.persona,
      'Registro completado',
      'Tu registro fue completado y el medio de pago quedo cargado.',
      'alerta'
    );

    return payment;
  });

  const user = await loadUserByPersonaId(db, pre.persona);
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });

  return res.status(200).json({
    message: 'Registro completado correctamente.',
    token,
    user: await publicUser(db, user),
    payment: savedPayment,
  });
});

router.patch('/me/cuenta-cobro', requireAuth, async (req, res) => {
  const { banco, cbu, alias } = req.body;

  if (!banco || !cbu || !alias) {
    return res.status(422).json({ message: 'Banco, CBU y alias son obligatorios' });
  }

  const db = getDatabase();
  await db.prepare(
    `UPDATE app_credenciales
     SET "cuentaCobroBanco" = ?, "cuentaCobroCbu" = ?, "cuentaCobroAlias" = ?
     WHERE persona = ?`
  ).run(banco.trim(), cbu.trim(), alias.trim(), req.user.id);

  const updated = await loadUserByPersonaId(db, req.user.id);
  return res.json({ message: 'Cuenta de cobro actualizada', profile: await publicUser(db, updated) });
});

// PATCH /api/usuarios/:id/admision
// Back-office action: admit or reject a client and optionally assign a category.
router.patch('/:id/admision', requireAuth, requireBackoffice, async (req, res) => {
  const { admitido, categoria } = req.body || {};
  if (admitido !== 'si' && admitido !== 'no') {
    return res.status(400).json({ message: "admitido debe ser 'si' o 'no'" });
  }
  if (categoria !== undefined && !categoryOrder.includes(categoria)) {
    return res.status(400).json({ message: `categoria invalida. Validas: ${categoryOrder.join(', ')}` });
  }

  const db = getDatabase();
  const cliente = await db.prepare('SELECT identificador FROM clientes WHERE identificador = ?').get(req.params.id);
  if (!cliente) {
    return res.status(404).json({ message: 'Cliente no encontrado (revisa el id de la persona/cliente)' });
  }

  const pre = await db
    .prepare(
      `SELECT identificador AS id, persona, cliente, email, estado, "categoriaAsignada", "tokenRegistro", "aprobadoEn"
       FROM app_pre_registros
       WHERE persona = ?
       ORDER BY identificador DESC
       LIMIT 1`
    )
    .get(req.params.id);

  if (pre && pre.estado !== 'completado') {
    try {
      if (admitido === 'si') {
        await approvePreRegistration(db, pre, categoria);
      } else {
        await rejectPreRegistration(db, pre);
      }
    } catch (error) {
      if (isEmailDeliveryError(error)) {
        return respondEmailDeliveryError(res, error);
      }
      throw error;
    }
  } else {
    if (categoria !== undefined) {
      await db.prepare('UPDATE clientes SET admitido = ?, categoria = ? WHERE identificador = ?')
        .run(admitido, categoria, req.params.id);
    } else {
      await db.prepare('UPDATE clientes SET admitido = ? WHERE identificador = ?').run(admitido, req.params.id);
    }
  }

  const titulo = admitido === 'si' ? 'Cuenta admitida' : 'Solicitud no admitida';
  const cuerpo =
    admitido === 'si'
      ? `Tu cuenta fue admitida por la empresa${categoria ? ` con categoria ${categoria}` : ''}. Ya podes participar en las subastas habilitadas.`
      : 'Tu solicitud todavia no fue admitida por la empresa.';
  await insertMensaje(db, Number(req.params.id), titulo, cuerpo, 'alerta');

  const updated = await loadUserByPersonaId(db, req.params.id);
  return res.json({
    message: admitido === 'si' ? 'Cliente admitido' : 'Cliente marcado como no admitido',
    user: await publicUser(db, updated),
  });
});

// POST /api/usuarios/pre-registro/aprobar   body: { email, categoria? }
// Back-office action: approve a pre-registration immediately.
router.post('/pre-registro/aprobar', requireAuth, requireBackoffice, async (req, res) => {
  const { email, categoria } = req.body || {};
  if (!email) {
    return res.status(422).json({ message: 'email es obligatorio' });
  }
  if (categoria !== undefined && !categoryOrder.includes(categoria)) {
    return res.status(400).json({ message: `categoria invalida. Validas: ${categoryOrder.join(', ')}` });
  }

  const db = getDatabase();
  const pre = await getPreRegistrationByEmail(db, normalizeEmail(email));
  if (!pre) {
    return res.status(404).json({ message: 'No hay una solicitud de registro para ese email' });
  }
  if (pre.estado === 'completado') {
    return res.status(409).json({ message: 'El registro de ese email ya fue completado.' });
  }

  try {
    const updated = await approvePreRegistration(db, pre, categoria);
    return res.json({
      message: 'Solicitud aprobada. Se envio el codigo de registro por email.',
      preRegistro: publicPreRegistration(updated),
    });
  } catch (error) {
    if (isEmailDeliveryError(error)) {
      return respondEmailDeliveryError(res, error);
    }
    throw error;
  }
});

// POST /api/usuarios/pre-registro/rechazar   body: { email }
// Back-office action: reject a pre-registration by email.
router.post('/pre-registro/rechazar', requireAuth, requireBackoffice, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(422).json({ message: 'email es obligatorio' });
  }

  const db = getDatabase();
  const pre = await getPreRegistrationByEmail(db, normalizeEmail(email));
  if (!pre) {
    return res.status(404).json({ message: 'No hay una solicitud de registro para ese email' });
  }
  if (pre.estado === 'completado') {
    return res.status(409).json({ message: 'El registro de ese email ya fue completado.' });
  }

  const updated = await rejectPreRegistration(db, pre);
  return res.json({ message: 'Solicitud rechazada.', preRegistro: publicPreRegistration(updated) });
});

module.exports = router;
