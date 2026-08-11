const express = require('express');
const { getDatabase } = require('../db/database');
const { requireAuth, requireBackoffice } = require('../middleware/auth');
const { insertMensaje } = require('../db/repository');

const router = express.Router();

// El flujo de "publicar articulo" (propuesta -> revision -> aprobado) usa la
// tabla auxiliar app_articulos: `productos` modela articulos ya inspeccionados
// (revisor NOT NULL), no la etapa de propuesta del usuario.

const ARTICLE_FIELDS = `identificador AS id, titulo, descripcion, "imagenFrente" AS "imagenFrente",
  "imagenDorso" AS "imagenDorso", "precioEstimado" AS "precioEstimado", estado,
  "condicionesVenta" AS "condicionesVenta", producto, "creadoEn" AS "createdAt"`;

// Estados validos de un articulo (CHECK de app_articulos.estado).
const ARTICLE_STATES = ['propuesta', 'en_revision', 'aprobado', 'rechazado', 'en_subasta', 'vendido'];

const MIN_FOTOS = 6;
const DECLARACION_PROPIEDAD_DEFAULT =
  'Declaro bajo juramento ser legitimo propietario del articulo o tener derechos para venderlo.';

// Texto por defecto del paso de seguimiento segun el nuevo estado.
const TRACKING_TEXT = {
  en_revision: 'Articulo en revision por el equipo de catalogacion.',
  aprobado: 'Articulo aprobado para subasta. Se asignara a un catalogo proximo.',
  rechazado: 'Articulo rechazado. Se devolvera al duenio con cargo, con las causas del rechazo.',
  en_subasta: 'Articulo incluido en una subasta.',
  vendido: 'Articulo vendido en subasta.',
};

const cleanString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseBooleanInput = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'si', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
};

const boolFromDb = (value) => {
  if (value === undefined || value === null) return null;
  return Number(value) === 1;
};

const normalizeFotos = (fotos, legacyFotos = []) => {
  let values = fotos;
  if (typeof fotos === 'string') {
    try {
      values = JSON.parse(fotos);
    } catch (error) {
      values = [fotos];
    }
  }
  const allValues = [...(Array.isArray(values) ? values : []), ...legacyFotos];
  return [...new Set(allValues.map(cleanString).filter(Boolean))];
};

const parseFotosFromDb = (value) => normalizeFotos(value);

const buildDocumentation = (documentation, article) => {
  const legacyFotos = normalizeFotos(null, [article.imagenFrente, article.imagenDorso]);
  if (!documentation) {
    return {
      fotos: legacyFotos,
      informacion_historica: null,
      documento_origen: null,
      declaracion_propiedad: null,
      acepta_devolucion_con_cargo: null,
      acepta_condiciones: null,
      condiciones_respondidas_en: null,
      createdAt: null,
    };
  }

  const fotos = parseFotosFromDb(documentation.fotos);
  return {
    id: documentation.id,
    fotos: fotos.length > 0 ? fotos : legacyFotos,
    informacion_historica: documentation.informacion_historica || null,
    documento_origen: documentation.documento_origen || null,
    declaracion_propiedad: documentation.declaracion_propiedad || null,
    acepta_devolucion_con_cargo: boolFromDb(documentation.acepta_devolucion_con_cargo),
    acepta_condiciones: boolFromDb(documentation.acepta_condiciones),
    condiciones_respondidas_en: documentation.condiciones_respondidas_en || null,
    createdAt: documentation.createdAt || null,
  };
};

const normalizePrecio = (value) => {
  if (value === undefined || value === null || value === '') return { value: null };
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return { error: 'precio_estimado debe ser numerico' };
  }
  return { value: numberValue };
};

const getDocumentation = (db, articleId) =>
  db
    .prepare(
      `SELECT identificador AS id, fotos,
        "informacionHistorica" AS "informacion_historica",
        "documentoOrigen" AS "documento_origen",
        "declaracionPropiedad" AS "declaracion_propiedad",
        "aceptaDevolucionConCargo" AS "acepta_devolucion_con_cargo",
        "aceptaCondiciones" AS "acepta_condiciones",
        "condicionesRespondidasEn" AS "condiciones_respondidas_en",
        "creadoEn" AS "createdAt"
       FROM "app_articuloDocumentacion"
       WHERE articulo = ?`
    )
    .get(articleId);

const getSaleInfo = (db, articleId) =>
  db
    .prepare(
      `SELECT ic."precioBase" AS "valor_base", ic.comision,
        s.ubicacion AS "ubicacion_deposito",
        pr.seguro AS "poliza_seguro",
        cat.descripcion AS "subasta_asignada"
       FROM app_articulos aa
       LEFT JOIN productos pr ON pr.identificador = aa.producto
       LEFT JOIN "itemsCatalogo" ic ON ic.producto = pr.identificador
       LEFT JOIN catalogos cat ON cat.identificador = ic.catalogo
       LEFT JOIN subastas s ON s.identificador = cat.subasta
       WHERE aa.identificador = ?
       ORDER BY ic.identificador DESC
       LIMIT 1`
    )
    .get(articleId);

const hasCuentaCobro = async (db, personaId) => {
  const row = await db
    .prepare(
      `SELECT "cuentaCobroBanco" AS banco, "cuentaCobroCbu" AS cbu, "cuentaCobroAlias" AS alias
       FROM app_credenciales
       WHERE persona = ?`
    )
    .get(personaId);
  return Boolean(row?.banco && row?.cbu && row?.alias);
};

const attachDocumentationSummaries = async (db, articles) => {
  if (!articles.length) return articles;

  const placeholders = articles.map(() => '?').join(',');
  const docs = await db
    .prepare(
      `SELECT articulo, fotos, "aceptaCondiciones" AS "acepta_condiciones"
       FROM "app_articuloDocumentacion"
       WHERE articulo IN (${placeholders})`
    )
    .all(...articles.map((article) => article.id));
  const docsByArticle = new Map(docs.map((doc) => [Number(doc.articulo), doc]));
  const conditionSteps = await db
    .prepare(
      `SELECT articulo, estado
       FROM "app_articuloSeguimiento"
       WHERE articulo IN (${placeholders})
        AND estado IN ('aceptado', 'condiciones_aceptadas', 'condiciones_rechazadas')`
    )
    .all(...articles.map((article) => article.id));
  const conditionStateByArticle = new Map();
  conditionSteps.forEach((step) => {
    conditionStateByArticle.set(Number(step.articulo), step.estado);
  });

  return articles.map((article) => {
    const doc = docsByArticle.get(Number(article.id));
    const aceptaCondiciones = doc ? boolFromDb(doc.acepta_condiciones) : null;
    const conditionState = conditionStateByArticle.get(Number(article.id));
    const estadoVisual =
      aceptaCondiciones === true
        ? 'condiciones_aceptadas'
        : aceptaCondiciones === false
          ? 'condiciones_rechazadas'
          : conditionState === 'aceptado'
            ? 'condiciones_propuestas'
            : conditionState || article.estado;

    return {
      ...article,
      fotos: doc
        ? normalizeFotos(doc.fotos, [article.imagenFrente, article.imagenDorso])
        : normalizeFotos(null, [article.imagenFrente, article.imagenDorso]),
      aceptaCondiciones,
      estadoVisual,
    };
  });
};

router.get('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const articles = await db
    .prepare(`SELECT ${ARTICLE_FIELDS} FROM app_articulos WHERE persona = ? ORDER BY "creadoEn" DESC`)
    .all(req.user.id);

  return res.json({ articles: await attachDocumentationSummaries(db, articles) });
});

router.post('/propuesta', requireAuth, async (req, res) => {
  const body = req.body || {};
  const titulo = cleanString(body.titulo);
  const descripcion = cleanString(body.descripcion);
  const informacionHistorica = cleanString(body.informacion_historica ?? body.informacionHistorica ?? body.condicionesVenta);
  const documentoOrigen = cleanString(body.documento_origen ?? body.documentoOrigen);
  const declaracionPropiedad =
    body.declaracion_propiedad === true || body.declaracionPropiedad === true
      ? DECLARACION_PROPIEDAD_DEFAULT
      : cleanString(body.declaracion_propiedad ?? body.declaracionPropiedad);
  const aceptaDevolucion = parseBooleanInput(
    body.acepta_devolucion_con_cargo ?? body.aceptaDevolucionConCargo
  );
  const fotos = normalizeFotos(body.fotos, [body.imagenFrente, body.imagenDorso]);
  const precio = normalizePrecio(body.precio_estimado ?? body.precioEstimado);

  if (precio.error) {
    return res.status(422).json({ message: precio.error });
  }

  const missing = [];
  if (!titulo) missing.push('titulo');
  if (!descripcion) missing.push('descripcion');
  if (!documentoOrigen) missing.push('documento_origen');
  if (!declaracionPropiedad) missing.push('declaracion_propiedad');
  if (aceptaDevolucion !== true) missing.push('acepta_devolucion_con_cargo');

  if (missing.length > 0) {
    return res.status(422).json({ message: `Faltan datos obligatorios: ${missing.join(', ')}` });
  }
  if (fotos.length < MIN_FOTOS) {
    return res.status(422).json({ message: `Se requieren al menos ${MIN_FOTOS} fotos del articulo` });
  }

  const db = getDatabase();
  if (!(await hasCuentaCobro(db, req.user.id))) {
    return res.status(403).json({
      message:
        'Antes de publicar articulos, configura tu cuenta de cobro desde Mi cuenta para poder recibir el dinero de futuras ventas.',
    });
  }

  const articleId = await db.transaction(async (tx) => {
    const result = await tx
      .prepare(
        `INSERT INTO app_articulos
          (persona, titulo, descripcion, "imagenFrente", "imagenDorso", "precioEstimado", "condicionesVenta")
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         RETURNING "identificador"`
      )
      .run(
        req.user.id,
        titulo,
        descripcion,
        fotos[0] || null,
        fotos[1] || null,
        precio.value,
      );

    const newArticleId = result.lastInsertRowid;
    await tx
      .prepare(
        `INSERT INTO "app_articuloDocumentacion"
          ("articulo", "fotos", "informacionHistorica", "documentoOrigen", "declaracionPropiedad", "aceptaDevolucionConCargo")
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        newArticleId,
        JSON.stringify(fotos),
        informacionHistorica || null,
        documentoOrigen,
        declaracionPropiedad,
        1
      );
    await tx
      .prepare('INSERT INTO "app_articuloSeguimiento" (articulo, estado, descripcion) VALUES (?, ?, ?)')
      .run(newArticleId, 'propuesta', 'Propuesta recibida. Sera evaluada por el equipo.');

    return newArticleId;
  });

  const article = await db.prepare(`SELECT ${ARTICLE_FIELDS} FROM app_articulos WHERE identificador = ?`).get(articleId);
  const documentation = buildDocumentation(await getDocumentation(db, articleId), article);
  return res.status(201).json({
    message: 'Propuesta enviada correctamente',
    article,
    documentacion: documentation,
    fotos: documentation.fotos,
  });
});

router.get('/:id/seguimiento', requireAuth, async (req, res) => {
  const db = getDatabase();
  const article = await db
    .prepare(`SELECT ${ARTICLE_FIELDS} FROM app_articulos WHERE identificador = ? AND persona = ?`)
    .get(req.params.id, req.user.id);

  if (!article) {
    return res.status(404).json({ message: 'Articulo no encontrado' });
  }

  const tracking = await db
    .prepare(
      `SELECT identificador AS id, estado, descripcion, "creadoEn" AS "createdAt"
       FROM "app_articuloSeguimiento" WHERE articulo = ?
       ORDER BY "creadoEn" ASC, identificador ASC`
    )
    .all(article.id);

  const documentation = buildDocumentation(await getDocumentation(db, article.id), article);
  const saleInfo = (await getSaleInfo(db, article.id)) || {};
  const hasCondicionesInformadas =
    ['aprobado', 'en_subasta', 'vendido'].includes(article.estado) ||
    tracking.some((entry) => ['aceptado', 'condiciones_aceptadas', 'condiciones_rechazadas'].includes(entry.estado));
  const valorBase =
    saleInfo.valor_base !== undefined && saleInfo.valor_base !== null
      ? Number(saleInfo.valor_base)
      : hasCondicionesInformadas && article.precioEstimado !== null
        ? Number(article.precioEstimado)
        : null;
  const comision =
    saleInfo.comision !== undefined && saleInfo.comision !== null
      ? Number(saleInfo.comision)
      : valorBase !== null
        ? Number((valorBase * 0.05).toFixed(2))
        : null;
  const rechazo = [...tracking].reverse().find((entry) => ['rechazado', 'rechazada'].includes(entry.estado));

  return res.json({
    article: { ...article, fotos: documentation.fotos, aceptaCondiciones: documentation.acepta_condiciones },
    tracking,
    valor_base: valorBase,
    comision,
    ubicacion_deposito: saleInfo.ubicacion_deposito || null,
    poliza_seguro: saleInfo.poliza_seguro || null,
    subasta_asignada: saleInfo.subasta_asignada || null,
    motivo_rechazo: rechazo ? rechazo.descripcion : null,
    documentacion: documentation,
    fotos: documentation.fotos,
  });
});

router.patch('/:id/condiciones', requireAuth, async (req, res) => {
  const acepta = parseBooleanInput((req.body || {}).acepta);
  if (acepta === null) {
    return res.status(422).json({ message: 'El campo acepta debe ser true o false' });
  }

  const db = getDatabase();
  const article = await db
    .prepare('SELECT identificador AS id, estado FROM app_articulos WHERE identificador = ? AND persona = ?')
    .get(req.params.id, req.user.id);

  if (!article) {
    return res.status(404).json({ message: 'Articulo no encontrado' });
  }
  if (article.estado === 'vendido') {
    return res.status(400).json({ message: 'No se pueden modificar condiciones de un articulo vendido' });
  }

  const pendingConditionStep = await db
    .prepare(
      `SELECT 1
       FROM "app_articuloSeguimiento"
       WHERE articulo = ? AND estado = 'aceptado'
       LIMIT 1`
    )
    .get(article.id);
  const documentation = await getDocumentation(db, article.id);
  const decisionAlreadyMade =
    documentation &&
    documentation.acepta_condiciones !== undefined &&
    documentation.acepta_condiciones !== null;

  if (!pendingConditionStep || decisionAlreadyMade) {
    return res.status(409).json({
      message: 'El articulo no tiene condiciones pendientes de aceptacion',
    });
  }

  const trackingState = acepta ? 'condiciones_aceptadas' : 'condiciones_rechazadas';
  const trackingText = acepta
    ? 'El usuario acepto el valor base y la comision informados.'
    : 'El usuario no acepto las condiciones. Se procedera a la devolucion con cargo.';

  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO "app_articuloDocumentacion"
          ("articulo", "fotos", "declaracionPropiedad", "aceptaDevolucionConCargo", "aceptaCondiciones", "condicionesRespondidasEn")
         VALUES (?, '[]', ?, 0, ?, to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
         ON CONFLICT ("articulo") DO UPDATE SET
          "aceptaCondiciones" = EXCLUDED."aceptaCondiciones",
          "condicionesRespondidasEn" = EXCLUDED."condicionesRespondidasEn",
          "actualizadoEn" = to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')`
      )
      .run(article.id, 'No registrada en la carga inicial.', acepta ? 1 : 0);
    await tx
      .prepare('INSERT INTO "app_articuloSeguimiento" (articulo, estado, descripcion) VALUES (?, ?, ?)')
      .run(article.id, trackingState, trackingText);
  });

  return res.json({
    message: acepta
      ? 'Condiciones aceptadas. Se registro la aceptacion del valor base y la comision.'
      : 'Condiciones rechazadas. Se procedera a la devolucion con cargo.',
    id_articulo: article.id,
    condiciones_aceptadas: acepta,
    estado_actual: article.estado,
    acepta,
  });
});

// PATCH /api/articulos/:id/estado
// Back-office action: approve/reject/advance the article state and record tracking.
// articulo y registra el paso en el seguimiento. Es una operacion de back-office
// autenticada con JWT de empleado.
router.patch('/:id/estado', requireAuth, requireBackoffice, async (req, res) => {
  const { estado, descripcion } = req.body;
  if (!estado || !ARTICLE_STATES.includes(estado)) {
    return res.status(400).json({ message: `Estado invalido. Validos: ${ARTICLE_STATES.join(', ')}` });
  }

  const db = getDatabase();
  const article = await db
    .prepare('SELECT identificador AS id, persona, titulo, estado FROM app_articulos WHERE identificador = ?')
    .get(req.params.id);
  if (!article) {
    return res.status(404).json({ message: 'Articulo no encontrado' });
  }

  await db.transaction(async (tx) => {
    await tx.prepare('UPDATE app_articulos SET estado = ? WHERE identificador = ?').run(estado, article.id);

    const texto = descripcion || TRACKING_TEXT[estado] || `Estado actualizado a ${estado}.`;
    await tx.prepare('INSERT INTO "app_articuloSeguimiento" (articulo, estado, descripcion) VALUES (?, ?, ?)')
      .run(article.id, estado, texto);

    // Al aprobar, ademas se informan tasacion/comisiones: se agrega el paso
    // 'aceptado' que habilita en la app la revision de las condiciones de venta.
    if (estado === 'aprobado') {
      await tx.prepare('INSERT INTO "app_articuloSeguimiento" (articulo, estado, descripcion) VALUES (?, ?, ?)')
        .run(article.id, 'aceptado', 'Tasacion y comisiones informadas. Revisa y acepta las condiciones de venta.');
    }

    await insertMensaje(
      tx,
      article.persona,
      'Actualizacion de tu articulo',
      `Tu articulo "${article.titulo}" paso al estado: ${estado}.`,
      'alerta'
    );
  });

  const updated = await db.prepare(`SELECT ${ARTICLE_FIELDS} FROM app_articulos WHERE identificador = ?`).get(article.id);
  return res.json({ message: `Articulo actualizado a "${estado}"`, article: updated });
});

module.exports = router;
