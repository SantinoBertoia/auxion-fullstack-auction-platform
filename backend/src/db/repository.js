// Capa de acceso a datos: traduce entre el modelo relacional (personas,
// clientes, app_*...) y los objetos/JSON que espera la app. No contiene logica
// de la sala en vivo (eso vive en services/auctionEngine.js).
//
// PostgreSQL: los identificadores camelCase van entre comillas dobles para
// preservar el caso; los de una sola palabra en minuscula no lo necesitan.
// Todas las funciones que tocan la base son async (await sobre el pool de pg).

const { ESTADO_PERSONA_INACTIVO } = require('../utils/businessRules');

// ---------------------------------------------------------------------------
// Usuarios (personas + clientes + credenciales de la app)
// ---------------------------------------------------------------------------

// Carga un usuario "de la app" combinando persona, su fila de cliente (si existe)
// y sus credenciales/perfil auxiliares. `id` es siempre el identificador de la
// persona (que tambien coincide con clientes.identificador cuando el usuario es cliente).
const loadUserByPersonaId = async (db, personaId) => {
  const row = await db
    .prepare(
      `SELECT
         p."identificador"      AS id,
         p."nombre"             AS nombre,
         p."documento"          AS documento,
         p."direccion"          AS direccion,
         p."estado"             AS "estadoPersona",
         c."identificador"      AS "clienteId",
         c."admitido"           AS admitido,
         c."categoria"          AS categoria,
         c."numeroPais"         AS "numeroPais",
         cr."email"             AS email,
         cr."cuentaCobroBanco"  AS "cuentaCobroBanco",
         cr."cuentaCobroCbu"    AS "cuentaCobroCbu",
         cr."cuentaCobroAlias"  AS "cuentaCobroAlias",
         pr."estado"            AS "estadoPreRegistro",
         e."identificador"      AS "empleadoId",
         e."cargo"              AS "cargoEmpleado",
         e."sector"             AS "sectorEmpleado"
       FROM "personas" p
       LEFT JOIN "clientes" c          ON c."identificador" = p."identificador"
       LEFT JOIN "empleados" e         ON e."identificador" = p."identificador"
       LEFT JOIN "app_credenciales" cr ON cr."persona" = p."identificador"
       LEFT JOIN "app_pre_registros" pr ON pr."persona" = p."identificador"
       WHERE p."identificador" = ?`
    )
    .get(personaId);

  if (!row) {
    return null;
  }

  return {
    ...row,
    esCliente: row.clienteId != null,
    esEmpleado: row.empleadoId != null,
    blocked: row.estadoPersona === ESTADO_PERSONA_INACTIVO,
  };
};

const loadUserByEmail = async (db, email) => {
  const cred = await db
    .prepare('SELECT "persona" FROM "app_credenciales" WHERE lower("email") = lower(?)')
    .get(email);
  if (!cred) {
    return null;
  }
  return loadUserByPersonaId(db, cred.persona);
};

const getPasswordHash = async (db, personaId) => {
  const cred = await db
    .prepare('SELECT "passwordHash" FROM "app_credenciales" WHERE "persona" = ?')
    .get(personaId);
  return cred ? cred.passwordHash : null;
};

// clientes.admitido / personas.estado -> estado de admision que entiende el front.
const deriveEstadoAdmision = (user) => {
  if (!user) return 'rechazado';
  if (user.estadoPersona === ESTADO_PERSONA_INACTIVO) return 'rechazado';
  if (user.estadoPreRegistro === 'rechazado') return 'rechazado';
  if (!user.esCliente) return 'en_revision';
  if (user.admitido === 'si') return 'aprobado';
  return 'en_revision';
};

const getPaisNombre = async (db, numeroPais) => {
  if (numeroPais == null) return null;
  const pais = await db.prepare('SELECT "nombre" FROM "paises" WHERE "numero" = ?').get(numeroPais);
  return pais ? pais.nombre : null;
};

// Forma publica del usuario (sin hash de password). Mantiene el contrato del front.
const publicUser = async (db, user) => ({
  id: user.id,
  email: user.email || null,
  nombre: user.nombre,
  apellido: '', // personas.nombre guarda el nombre completo; no hay columna apellido.
  documento: user.documento || null,
  domicilio: user.direccion || null,
  pais: await getPaisNombre(db, user.numeroPais),
  estadoAdmision: user.esEmpleado ? 'aprobado' : deriveEstadoAdmision(user),
  estadoRegistro: user.estadoPreRegistro || (user.email ? 'completado' : 'sin_credencial'),
  registroCompleto: Boolean(
    user.email &&
      user.estadoPersona !== ESTADO_PERSONA_INACTIVO &&
      (user.esEmpleado || user.admitido === 'si')
  ),
  rol: user.esEmpleado ? 'empleado' : 'cliente',
  permisos: user.esEmpleado ? ['backoffice'] : [],
  categoria: user.categoria || null,
  cuentaCobro: {
    banco: user.cuentaCobroBanco || null,
    cbu: user.cuentaCobroCbu || null,
    alias: user.cuentaCobroAlias || null,
  },
});

// ---------------------------------------------------------------------------
// Medios de pago (auxiliar app_mediosPago)
// ---------------------------------------------------------------------------

const maskPaymentNumber = (value, type) => {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.includes('*')) return text;

  const compact = text.replace(/\s+/g, '');
  const lastFour = compact.slice(-4).padStart(4, '*');
  if (type === 'tarjeta') return `**** **** **** ${lastFour}`;
  if (type === 'cuenta_bancaria') return `Account ending ${lastFour}`;
  if (type === 'cheque_certificado') return `Check ending ${lastFour}`;
  return `Reference ending ${lastFour}`;
};

const publicPayment = (payment) => {
  if (!payment) return null;
  const maskedNumber = maskPaymentNumber(payment.numero, payment.tipo);
  return {
    ...payment,
    numero: maskedNumber,
    numeroEnmascarado: maskedNumber,
  };
};

const listMediosPago = async (db, clienteId) => {
  const rows = await db
    .prepare(
      `SELECT "identificador" AS id, "tipo", "alias", "moneda", "numero", "banco",
        "montoGarantia" AS "montoGarantia", "verificado", "creadoEn" AS "createdAt"
       FROM "app_mediosPago"
       WHERE "cliente" = ?
       ORDER BY "verificado" DESC, "identificador" ASC`
    )
    .all(clienteId);
  return rows.map(publicPayment);
};

const getPublicMedioPago = async (db, id, clienteId) => {
  const row = await db
    .prepare(
      `SELECT "identificador" AS id, "tipo", "alias", "moneda", "numero", "banco",
        "montoGarantia" AS "montoGarantia", "verificado", "creadoEn" AS "createdAt"
       FROM "app_mediosPago"
       WHERE "identificador" = ? AND "cliente" = ?`
    )
    .get(id, clienteId);
  return publicPayment(row);
};

const getMedioPago = (db, id, clienteId) =>
  db.prepare('SELECT * FROM "app_mediosPago" WHERE "identificador" = ? AND "cliente" = ?').get(id, clienteId);

const getVerifiedPaymentCount = async (db, clienteId) => {
  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM "app_mediosPago" WHERE "cliente" = ? AND "verificado" = 1')
    .get(clienteId);
  return row.total;
};

// ---------------------------------------------------------------------------
// Mensajeria (auxiliar app_mensajes)
// ---------------------------------------------------------------------------

const insertMensaje = (db, personaId, titulo, cuerpo, tipo) =>
  db
    .prepare('INSERT INTO "app_mensajes" ("persona", "titulo", "cuerpo", "tipo") VALUES (?, ?, ?, ?)')
    .run(personaId, titulo, cuerpo, tipo);

const listMensajes = (db, personaId, limit = 6) =>
  db
    .prepare(
      `SELECT "identificador" AS id, "titulo", "cuerpo", "tipo", "creadoEn" AS "createdAt"
       FROM "app_mensajes"
       WHERE "persona" = ?
       ORDER BY "identificador" DESC
       LIMIT ?`
    )
    .all(personaId, limit);

module.exports = {
  loadUserByPersonaId,
  loadUserByEmail,
  getPasswordHash,
  deriveEstadoAdmision,
  getPaisNombre,
  publicUser,
  maskPaymentNumber,
  publicPayment,
  listMediosPago,
  getMedioPago,
  getPublicMedioPago,
  getVerifiedPaymentCount,
  insertMensaje,
  listMensajes,
};
