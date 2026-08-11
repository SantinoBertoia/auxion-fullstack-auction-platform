// Motor de la sala en vivo sobre el modelo relacional.
//
// Tiempo POR ARTICULO (no por subasta completa): cada itemsCatalogo se subasta
// durante ITEM_DURATION_SECONDS. Cuando
// ese minuto termina se define el ganador del articulo por mejor puja, se marca
// el item como subastado, se actualiza el producto y se registra la venta en
// registroDeSubasta. Cuando ya pasaron todos los articulos del catalogo, la
// subasta completa pasa a 'cerrada' (finalizada).
//
// subastas.estado solo admite 'abierta'/'cerrada'. Los estados 'proxima' y
// 'finalizada' que necesita el front son de presentacion y se derivan aca a
// partir de app_subastaRuntime (abiertaEn / inicioProgramado).

const {
  calculateBidLimits,
  ESTADO_SUBASTA_ABIERTA,
  ESTADO_SUBASTA_CERRADA,
} = require('../utils/businessRules');
const { insertMensaje } = require('../db/repository');

const ITEM_DURATION_SECONDS = 60; // un minuto por articulo
const DISPLAY_TIMEZONE = 'America/Argentina/Buenos_Aires';

// ---------------------------------------------------------------------------
// Lecturas basicas
// ---------------------------------------------------------------------------

const getSubastaRow = (db, id) =>
  db.prepare('SELECT * FROM subastas WHERE identificador = ?').get(id);

const getRuntime = (db, subastaId) =>
  db.prepare('SELECT * FROM "app_subastaRuntime" WHERE subasta = ?').get(subastaId);

const getCatalogoForSubasta = (db, subastaId) =>
  db.prepare('SELECT * FROM catalogos WHERE subasta = ? ORDER BY identificador ASC LIMIT 1').get(subastaId);

const getSubastadorLabel = async (db, subastadorId) => {
  if (subastadorId == null) return 'Rematador a confirmar';
  const row = await db
    .prepare(
      `SELECT per.nombre AS nombre
       FROM subastadores s
       JOIN personas per ON per.identificador = s.identificador
       WHERE s.identificador = ?`
    )
    .get(subastadorId);
  return row ? `Rematador: ${row.nombre}` : 'Rematador a confirmar';
};

const getItems = (db, subastaId) =>
  db
    .prepare(
      `SELECT ic.identificador AS id, ic.catalogo, ic.producto, ic."precioBase" AS "precioBase",
        ic.comision, ic.subastado,
        pr."descripcionCatalogo" AS titulo, pr."descripcionCompleta" AS descripcion,
        pr.fecha AS "fechaObjeto", pr.duenio AS duenio,
        pi.url AS "imagenUrl"
       FROM "itemsCatalogo" ic
       JOIN catalogos cat ON cat.identificador = ic.catalogo
       JOIN productos pr ON pr.identificador = ic.producto
       LEFT JOIN "app_productoImagen" pi ON pi.producto = ic.producto
       WHERE cat.subasta = ?
       ORDER BY ic.identificador ASC`
    )
    .all(subastaId);

const mapLot = (subastaId, item) => {
  if (!item) return null;
  return {
    id: item.id,
    auctionId: subastaId,
    numeroPieza: `PZA-${String(item.producto).padStart(3, '0')}`,
    titulo: item.titulo,
    descripcion: item.descripcion,
    descripcionExtra: null, // productos no modela un texto extra separado
    precioBase: item.precioBase,
    artista: null, // no modelado en productos
    fechaObjeto: item.fechaObjeto || null,
    historia: null, // no modelado en productos
    imagenUrl: item.imagenUrl || null,
  };
};

// ---------------------------------------------------------------------------
// Pujas de un item (pujos)
// ---------------------------------------------------------------------------

const getBestPujoForItem = (db, itemId) =>
  db
    .prepare(
      `SELECT pj.identificador AS id, pj.importe AS monto, a.cliente AS "userId",
        per.nombre AS postor, cr.email AS email
       FROM pujos pj
       JOIN asistentes a ON a.identificador = pj.asistente
       JOIN personas per ON per.identificador = a.cliente
       LEFT JOIN app_credenciales cr ON cr.persona = a.cliente
       WHERE pj.item = ?
       ORDER BY pj.importe DESC, pj.identificador DESC
       LIMIT 1`
    )
    .get(itemId);

const getRecentPujosForItem = (db, itemId, limit = 5) =>
  db
    .prepare(
      `SELECT pj.identificador AS id, pj.importe AS monto, per.nombre AS postor
       FROM pujos pj
       JOIN asistentes a ON a.identificador = pj.asistente
       JOIN personas per ON per.identificador = a.cliente
       WHERE pj.item = ?
       ORDER BY pj.identificador DESC
       LIMIT ?`
    )
    .all(itemId, limit);

const getPaymentInfoForPujo = (db, pujoId) =>
  db
    .prepare(
      `SELECT apmp."medioPago" AS id, apmp.moneda, apmp.monto,
        mp.alias, mp.tipo
       FROM "app_pujaMedioPago" apmp
       JOIN "app_mediosPago" mp ON mp.identificador = apmp."medioPago"
       WHERE apmp.pujo = ?
       LIMIT 1`
    )
    .get(pujoId);

const mapAuctionWinnerRow = (row) => {
  return {
    userId: row.userId,
    postor: row.postor,
    email: row.email,
    monto: row.monto,
    moneda: row.moneda || null,
    lote:
      row.loteId || row.loteTitulo
        ? {
            id: row.loteId || null,
            titulo: row.loteTitulo || null,
          }
        : null,
  };
};

// Resultados a mostrar cuando la subasta termino: un registro por lote vendido.
const getAuctionWinners = async (db, subastaId) => {
  const rows = await db
    .prepare(
      `SELECT r.cliente AS "userId", per.nombre AS postor, cr.email AS email,
        r.importe AS monto, rt.moneda AS moneda,
        ic.identificador AS "loteId", pr."descripcionCatalogo" AS "loteTitulo"
       FROM "registroDeSubasta" r
       JOIN personas per ON per.identificador = r.cliente
       LEFT JOIN app_credenciales cr ON cr.persona = r.cliente
       LEFT JOIN "app_subastaRuntime" rt ON rt.subasta = r.subasta
       LEFT JOIN productos pr ON pr.identificador = r.producto
       LEFT JOIN catalogos cat ON cat.subasta = r.subasta
       LEFT JOIN "itemsCatalogo" ic ON ic.catalogo = cat.identificador AND ic.producto = r.producto
       WHERE r.subasta = ?
       ORDER BY r.identificador DESC`
    )
    .all(subastaId);

  return rows.map(mapAuctionWinnerRow);
};

// Se conserva para pantallas existentes: devuelve el ultimo lote vendido.
const getAuctionWinner = async (db, subastaId) => {
  const winners = await getAuctionWinners(db, subastaId);
  return winners[0] || null;
};

// ---------------------------------------------------------------------------
// Cierre de un articulo y de la subasta completa
// ---------------------------------------------------------------------------

// Cierra un articulo: define ganador por mejor puja, marca subastado, actualiza
// disponibilidad del producto y genera el registro economico en registroDeSubasta.
const finalizeItem = async (db, subastaId, item) => {
  const best = await getBestPujoForItem(db, item.id);
  await db.transaction(async (tx) => {
    await tx.prepare("UPDATE pujos SET ganador = 'no' WHERE item = ?").run(item.id);
    await tx.prepare("UPDATE \"itemsCatalogo\" SET subastado = 'si' WHERE identificador = ?").run(item.id);
    await tx.prepare("UPDATE productos SET disponible = 'no' WHERE identificador = ?").run(item.producto);

    if (!best) {
      // Sin pujas: la venta queda sin comprador registrado al finalizar.
      // registroDeSubasta exige un cliente comprador y la base no modela una
      // "empresa" como cliente, asi que ese registro queda pendiente documentado.
      return;
    }

    await tx.prepare("UPDATE pujos SET ganador = 'si' WHERE identificador = ?").run(best.id);

    const producto = await tx.prepare('SELECT duenio FROM productos WHERE identificador = ?').get(item.producto);
    const paymentInfo = await getPaymentInfoForPujo(tx, best.id);
    // cliente ganador = persona/cliente del asistente de la mejor puja.
    const clienteGanador = best.userId;

    // Registro economico: importe final + comision del item.
    await tx
      .prepare(
        `INSERT INTO "registroDeSubasta" (subasta, duenio, producto, cliente, importe, comision)
       VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(subastaId, producto.duenio, item.producto, clienteGanador, best.monto, item.comision);

    const paymentText = paymentInfo
      ? ` Medio de pago: ${paymentInfo.alias || paymentInfo.tipo} (#${paymentInfo.id}).`
      : '';
    const winnerMessage =
      `Ganaste "${item.titulo}" por ${Number(best.monto).toFixed(2)}. ` +
      `Comisión de la empresa: ${Number(item.comision).toFixed(2)}.` +
      paymentText +
      ' La venta quedó registrada.';

    await insertMensaje(
      tx,
      clienteGanador,
      'Artículo ganado',
      winnerMessage,
      'alerta'
    );
  });
};

const closeAuction = async (db, subastaRow) => {
  if (subastaRow.estado !== ESTADO_SUBASTA_CERRADA) {
    await db
      .prepare('UPDATE subastas SET estado = ? WHERE identificador = ?')
      .run(ESTADO_SUBASTA_CERRADA, subastaRow.identificador);
    subastaRow.estado = ESTADO_SUBASTA_CERRADA;
  }
};

// Avanza la sala: cierra los items cuyo minuto ya vencio y devuelve el item en
// curso + segundos restantes. Si ya pasaron todos, cierra la subasta completa.
const advanceSala = async (db, subastaRow, runtime, items, nowMs) => {
  const abiertaMs = new Date(runtime.abiertaEn).getTime();
  const elapsed = Math.max(0, (nowMs - abiertaMs) / 1000);
  const total = items.length;
  const dueCount = Math.min(Math.floor(elapsed / ITEM_DURATION_SECONDS), total);

  for (let i = 0; i < dueCount; i += 1) {
    if (items[i].subastado !== 'si') {
      await finalizeItem(db, subastaRow.identificador, items[i]);
      items[i].subastado = 'si';
    }
  }

  if (dueCount >= total) {
    await closeAuction(db, subastaRow);
    return { estado: 'finalizada', currentItem: null, segundosRestantes: null };
  }

  const currentIndex = dueCount;
  const currentItem = items[currentIndex];
  const segundosRestantes = Math.max(
    0,
    Math.ceil((currentIndex + 1) * ITEM_DURATION_SECONDS - elapsed)
  );
  return { estado: 'abierta', currentItem, segundosRestantes };
};

const formatDateTimeForDisplay = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour');
  const minute = pick('minute');

  if (!year || !month || !day || !hour || !minute) {
    return null;
  }

  return {
    fecha: `${year}-${month}-${day}`,
    hora: `${hour}:${minute}`,
  };
};

const getAuctionFinishedAt = (runtime, items) => {
  if (!runtime || !runtime.abiertaEn || !items.length) {
    return null;
  }

  const startedAtMs = new Date(runtime.abiertaEn).getTime();
  if (Number.isNaN(startedAtMs)) {
    return null;
  }

  return new Date(startedAtMs + items.length * ITEM_DURATION_SECONDS * 1000).toISOString();
};

const getAuctionDisplayDateTime = ({ estado, subastaRow, runtime, fechaInicio, fechaFin }) => {
  const source =
    estado === 'proxima'
      ? fechaInicio || runtime?.inicioProgramado
      : estado === 'abierta'
        ? fechaInicio || runtime?.abiertaEn
        : estado === 'finalizada'
          ? fechaFin || fechaInicio || runtime?.abiertaEn || runtime?.inicioProgramado
          : null;

  return formatDateTimeForDisplay(source) || {
    fecha: subastaRow.fecha,
    hora: subastaRow.hora,
  };
};

// ---------------------------------------------------------------------------
// Estado completo de una subasta (mapeo a la forma que espera el front)
// ---------------------------------------------------------------------------

// Devuelve { auction, currentItem, items, segundosRestantes } o null si no existe.
// startClockIfLive: si la subasta esta lista para ir en vivo y aun no arranco el
// reloj, lo inicia (abiertaEn = ahora). Se usa al entrar a la sala, no al listar.
const computeSala = async (db, subastaId, opts = {}) => {
  const subastaRow = await getSubastaRow(db, subastaId);
  if (!subastaRow) return null;

  const startClockIfLive = Boolean(opts.startClockIfLive);
  const nowMs = Date.now();
  const runtime = await getRuntime(db, subastaId);
  const moneda = runtime ? runtime.moneda : 'ARS';
  const catalogo = await getCatalogoForSubasta(db, subastaId);
  const titulo = catalogo ? catalogo.descripcion : `Subasta #${subastaId}`;
  const rematador = await getSubastadorLabel(db, subastaRow.subastador);

  let estado = 'abierta';
  let segundosRestantes = null;
  let currentItem = null;
  let fechaInicio = runtime ? runtime.abiertaEn : null;
  let fechaFin = null;
  let winner = null;
  let winners = [];
  // El catalogo (items) es publico y debe verse en cualquier estado de la subasta.
  const items = await getItems(db, subastaId);

  if (subastaRow.estado === ESTADO_SUBASTA_CERRADA) {
    estado = 'finalizada';
  } else if (runtime && runtime.inicioProgramado && nowMs < new Date(runtime.inicioProgramado).getTime()) {
    estado = 'proxima';
    segundosRestantes = Math.max(0, Math.ceil((new Date(runtime.inicioProgramado).getTime() - nowMs) / 1000));
    fechaInicio = runtime.inicioProgramado;
  } else {
    if (items.length === 0) {
      estado = 'finalizada';
    } else if (!runtime || !runtime.abiertaEn) {
      // Lista para ir en vivo pero el reloj todavia no arranco.
      if (startClockIfLive && runtime) {
        const iso = new Date(nowMs).toISOString();
        await db
          .prepare('UPDATE "app_subastaRuntime" SET "abiertaEn" = ? WHERE subasta = ?')
          .run(iso, subastaId);
        runtime.abiertaEn = iso;
        fechaInicio = iso;
        const res = await advanceSala(db, subastaRow, runtime, items, nowMs);
        estado = res.estado;
        currentItem = res.currentItem;
        segundosRestantes = res.segundosRestantes;
      } else {
        estado = 'abierta';
        currentItem = items.find((it) => it.subastado !== 'si') || null;
        segundosRestantes = ITEM_DURATION_SECONDS;
      }
    } else {
      const res = await advanceSala(db, subastaRow, runtime, items, nowMs);
      estado = res.estado;
      currentItem = res.currentItem;
      segundosRestantes = res.segundosRestantes;
    }
  }

  if (estado === 'finalizada') {
    fechaFin = getAuctionFinishedAt(runtime, items);
    winners = await getAuctionWinners(db, subastaId);
    winner = winners[0] || null;
  }

  const displayDateTime = getAuctionDisplayDateTime({
    estado,
    subastaRow,
    runtime,
    fechaInicio,
    fechaFin,
  });

  const auction = {
    id: subastaRow.identificador,
    titulo,
    fecha: displayDateTime.fecha,
    hora: displayDateTime.hora,
    estado,
    categoria: subastaRow.categoria,
    moneda,
    ubicacion: subastaRow.ubicacion,
    rematador,
    descripcion: catalogo ? catalogo.descripcion : null,
    // Imagen para la card/hero de la subasta: la del lote en curso o, si no hay,
    // la del primer lote del catalogo.
    imagenUrl: (currentItem && currentItem.imagenUrl) || (items[0] && items[0].imagenUrl) || null,
    fechaInicio,
    fechaFin,
    segundosRestantes,
    tiempoRestanteMs: segundosRestantes == null ? null : segundosRestantes * 1000,
    ganadorId: winner?.userId || null,
    finalizadaEn: fechaFin,
    winner,
    winners,
  };

  return { auction, currentItem, items, segundosRestantes };
};

const buildAuctionStatus = async (db, subastaId, userId) => {
  const sala = await computeSala(db, subastaId, { startClockIfLive: true });
  if (!sala) return null;

  const { auction, items } = sala;
  let currentItem = sala.currentItem;
  let winner = auction.winner || null;

  if (auction.estado === 'finalizada') {
    if (!winner) {
      winner = await getAuctionWinner(db, subastaId);
    }
    if (!currentItem) {
      currentItem = items[items.length - 1] || null;
    }
  }

  if (!currentItem) {
    return null;
  }

  const currentLot = mapLot(subastaId, currentItem);
  const bestBid = await getBestPujoForItem(db, currentItem.id);
  const recentBids = await getRecentPujosForItem(db, currentItem.id);
  const bestAmount = bestBid ? bestBid.monto : currentLot.precioBase;
  const limits = calculateBidLimits({
    auctionCategory: auction.categoria,
    basePrice: currentLot.precioBase,
    currentBestBid: bestAmount,
  });

  return {
    auction,
    currentLot,
    bestBid: bestBid || null,
    winner,
    winners: auction.winners || (winner ? [winner] : []),
    isBestBidder: Boolean(bestBid && Number(bestBid.userId) === Number(userId)),
    recentBids,
    suggestedMinimum: limits.minimum,
    maximumAllowed: limits.maximum,
    segundosRestantes: auction.segundosRestantes,
  };
};

// ---------------------------------------------------------------------------
// Asistentes / conexion a una subasta
// ---------------------------------------------------------------------------

const getOrCreateAsistente = async (db, clienteId, subastaId) => {
  const existing = await db
    .prepare('SELECT * FROM asistentes WHERE cliente = ? AND subasta = ?')
    .get(clienteId, subastaId);
  if (existing) return existing;

  const next =
    (await db
      .prepare('SELECT COALESCE(MAX("numeroPostor"), 100) + 1 AS next FROM asistentes WHERE subasta = ?')
      .get(subastaId)).next || 101;
  const result = await db
    .prepare(
      `INSERT INTO asistentes ("numeroPostor", cliente, subasta)
       VALUES (?, ?, ?)
       ON CONFLICT ("cliente","subasta") DO NOTHING
       RETURNING "identificador"`
    )
    .run(next, clienteId, subastaId);
  if (!result.lastInsertRowid) {
    return db.prepare('SELECT * FROM asistentes WHERE cliente = ? AND subasta = ?').get(clienteId, subastaId);
  }
  return db.prepare('SELECT * FROM asistentes WHERE identificador = ?').get(result.lastInsertRowid);
};

// Devuelve el id de OTRA subasta en vivo donde el cliente esta conectado, o null.
const getOtherLiveAuction = async (db, clienteId, subastaId) => {
  const row = await db
    .prepare(
      `SELECT s.identificador AS id
       FROM asistentes a
       JOIN subastas s ON s.identificador = a.subasta
       JOIN "app_subastaRuntime" rt ON rt.subasta = s.identificador
       WHERE a.cliente = ?
        AND s.identificador <> ?
        AND s.estado = ?
        AND rt."abiertaEn" IS NOT NULL
       LIMIT 1`
    )
    .get(clienteId, subastaId, ESTADO_SUBASTA_ABIERTA);
  return row ? row.id : null;
};

module.exports = {
  ITEM_DURATION_SECONDS,
  getItems,
  mapLot,
  getBestPujoForItem,
  getRecentPujosForItem,
  finalizeItem,
  advanceSala,
  computeSala,
  getAuctionWinner,
  getAuctionWinners,
  buildAuctionStatus,
  getOrCreateAsistente,
  getOtherLiveAuction,
};
