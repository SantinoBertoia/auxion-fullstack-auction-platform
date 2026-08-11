const express = require('express');

const { getDatabase } = require('../db/database');
const { attachUser, requireAuth, requireBackoffice } = require('../middleware/auth');
const {
  validateAuctionAccess,
  validateBid,
  categoryOrder,
  ESTADO_SUBASTA_CERRADA,
} = require('../utils/businessRules');
const {
  getVerifiedPaymentCount,
  getMedioPago,
  insertMensaje,
  loadUserByPersonaId,
} = require('../db/repository');
const {
  ITEM_DURATION_SECONDS,
  computeSala,
  buildAuctionStatus,
  getOrCreateAsistente,
  getOtherLiveAuction,
  getBestPujoForItem,
  mapLot,
} = require('../services/auctionEngine');

const router = express.Router();

const MONEDAS = ['ARS', 'USD'];

const getWonTotalForPaymentMethod = async (db, paymentMethodId, clienteId) => {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(apmp.monto), 0) AS total
       FROM "app_pujaMedioPago" apmp
       JOIN pujos pj ON pj.identificador = apmp.pujo
       WHERE apmp."medioPago" = ?
        AND apmp.cliente = ?
        AND pj.ganador = 'si'`
    )
    .get(paymentMethodId, clienteId);
  return Number(row?.total || 0);
};

const lockAuctionItemForBid = (db, itemId, auctionId) =>
  db
    .prepare(
      `SELECT ic.identificador AS id, ic.catalogo, ic.producto, ic."precioBase" AS "precioBase",
        ic.comision, ic.subastado,
        pr."descripcionCatalogo" AS titulo,
        s.identificador AS "auctionId", s.estado AS "estadoRaw", s.categoria,
        rt.moneda, rt."abiertaEn" AS "abiertaEn", rt."inicioProgramado" AS "inicioProgramado"
       FROM "itemsCatalogo" ic
       JOIN catalogos cat ON cat.identificador = ic.catalogo
       JOIN subastas s ON s.identificador = cat.subasta
       JOIN productos pr ON pr.identificador = ic.producto
       LEFT JOIN "app_subastaRuntime" rt ON rt.subasta = s.identificador
       WHERE ic.identificador = ? AND s.identificador = ?
       FOR UPDATE OF ic`
    )
    .get(itemId, auctionId);

const getAuctionItemOrder = (db, auctionId) =>
  db
    .prepare(
      `SELECT ic.identificador AS id, ic.subastado
       FROM "itemsCatalogo" ic
       JOIN catalogos cat ON cat.identificador = ic.catalogo
       WHERE cat.subasta = ?
       ORDER BY ic.identificador ASC`
    )
    .all(auctionId);

const getActiveLotIdForBid = async (db, lockedItem) => {
  if (lockedItem.estadoRaw === ESTADO_SUBASTA_CERRADA) {
    return {
      validationError: {
        status: 409,
        message: 'La subasta ya finalizó. No se aceptan nuevas pujas.',
      },
    };
  }

  const nowMs = Date.now();
  if (lockedItem.inicioProgramado && nowMs < new Date(lockedItem.inicioProgramado).getTime()) {
    return {
      validationError: {
        status: 403,
        message: 'La subasta todavía no está abierta',
      },
    };
  }

  const items = await getAuctionItemOrder(db, lockedItem.auctionId);
  if (items.length === 0) {
    return {
      validationError: {
        status: 409,
        message: 'No hay un artículo en subasta en este momento',
      },
    };
  }

  if (!lockedItem.abiertaEn) {
    const firstOpen = items.find((item) => item.subastado !== 'si');
    return { activeLotId: firstOpen ? Number(firstOpen.id) : null };
  }

  const startedAtMs = new Date(lockedItem.abiertaEn).getTime();
  if (Number.isNaN(startedAtMs)) {
    return {
      validationError: {
        status: 409,
        message: 'La sala de subasta no tiene un reloj válido',
      },
    };
  }

  const elapsed = Math.max(0, (nowMs - startedAtMs) / 1000);
  const dueCount = Math.min(Math.floor(elapsed / ITEM_DURATION_SECONDS), items.length);
  if (dueCount >= items.length) {
    return {
      validationError: {
        status: 409,
        message: 'La subasta ya finalizó. No se aceptan nuevas pujas.',
      },
    };
  }

  if (items[dueCount].subastado === 'si') {
    return {
      validationError: {
        status: 409,
        message: 'Ese articulo ya no se esta subastando. Actualiza la sala.',
      },
    };
  }

  return { activeLotId: Number(items[dueCount].id) };
};

// POST /api/subastas
// Back-office action: creates an auction with catalog and items in one request.
// No es del lado del postor (no hay UI en la app); la empresa programa subastas.
// Body: { titulo, categoria?, moneda?, ubicacion?, estado?('abierta'|'proxima'),
//         inicioEnMinutos?, items: [{ titulo, descripcion?, precioBase, comision?, fecha? }] }
router.post('/', requireAuth, requireBackoffice, async (req, res) => {
  const {
    titulo,
    categoria = 'comun',
    moneda = 'ARS',
    ubicacion = 'Online',
    estado = 'abierta',
    inicioEnMinutos = 60,
    items,
  } = req.body || {};

  if (!titulo || !Array.isArray(items) || items.length === 0) {
    return res.status(422).json({ message: 'titulo y al menos un item son obligatorios' });
  }
  if (!categoryOrder.includes(categoria)) {
    return res.status(400).json({ message: `categoria invalida. Validas: ${categoryOrder.join(', ')}` });
  }
  if (!MONEDAS.includes(moneda)) {
    return res.status(400).json({ message: `moneda invalida. Validas: ${MONEDAS.join(', ')}` });
  }
  if (estado !== 'abierta' && estado !== 'proxima') {
    return res.status(400).json({ message: "estado debe ser 'abierta' o 'proxima'" });
  }
  for (let i = 0; i < items.length; i += 1) {
    const pb = Number(items[i].precioBase);
    if (!items[i].titulo || !Number.isFinite(pb) || pb <= 0.01) {
      return res.status(400).json({ message: `item ${i + 1}: titulo y precioBase (> 0.01) son obligatorios` });
    }
  }

  const db = getDatabase();
  const subastador = await db.prepare('SELECT identificador FROM subastadores ORDER BY identificador ASC LIMIT 1').get();
  const empleado = await db.prepare('SELECT identificador FROM empleados ORDER BY identificador ASC LIMIT 1').get();
  const duenio = await db.prepare('SELECT identificador FROM duenios ORDER BY identificador ASC LIMIT 1').get();
  if (!subastador || !empleado || !duenio) {
    return res
      .status(422)
      .json({ message: 'Faltan datos base (subastador/empleado/duenio). Run npm run db:seed first.' });
  }

  const now = new Date();
  const fecha = now.toISOString().slice(0, 10);
  const hora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const inicioProgramado =
    estado === 'proxima'
      ? new Date(now.getTime() + Math.max(1, Number(inicioEnMinutos) || 60) * 60 * 1000).toISOString()
      : null;

  const subastaId = await db.transaction(async (tx) => {
    // subastas.estado solo admite 'abierta'/'cerrada'; 'proxima' se deriva del runtime.
    const sub = await tx
      .prepare(
        `INSERT INTO subastas
          (fecha, hora, estado, subastador, ubicacion, "capacidadAsistentes", "tieneDeposito", "seguridadPropia", categoria)
         VALUES (?, ?, 'abierta', ?, ?, 100, 'si', 'si', ?)
         RETURNING "identificador"`
      )
      .run(fecha, hora, subastador.identificador, ubicacion, categoria);
    const subId = sub.lastInsertRowid;

    const cat = await tx
      .prepare('INSERT INTO catalogos (descripcion, subasta, responsable) VALUES (?, ?, ?) RETURNING "identificador"')
      .run(titulo, subId, empleado.identificador);
    const catalogoId = cat.lastInsertRowid;

    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const pb = Number(it.precioBase);
      const com =
        Number.isFinite(Number(it.comision)) && Number(it.comision) > 0.01
          ? Number(it.comision)
          : Math.max(1, Math.round(pb * 0.05));
      const prod = await tx
        .prepare(
          `INSERT INTO productos (fecha, disponible, "descripcionCatalogo", "descripcionCompleta", revisor, duenio, seguro)
           VALUES (?, 'si', ?, ?, ?, ?, NULL)
           RETURNING "identificador"`
        )
        .run(it.fecha || null, it.titulo, it.descripcion || it.titulo, empleado.identificador, duenio.identificador);
      await tx
        .prepare(
          'INSERT INTO "itemsCatalogo" (catalogo, producto, "precioBase", comision, subastado) VALUES (?, ?, ?, ?, \'no\')'
        )
        .run(catalogoId, prod.lastInsertRowid, pb, com);
    }

    await tx
      .prepare('INSERT INTO "app_subastaRuntime" (subasta, moneda, "abiertaEn", "inicioProgramado") VALUES (?, ?, NULL, ?)')
      .run(subId, moneda, inicioProgramado);

    return subId;
  });

  const sala = await computeSala(db, subastaId, { startClockIfLive: false });
  return res.status(201).json({
    message: 'Subasta creada',
    subastaId,
    titulo,
    estado: sala.auction.estado,
    moneda,
    categoria,
    lotes: sala.items.map((it) => ({ id: it.id, titulo: it.titulo, precioBase: it.precioBase, comision: it.comision })),
  });
});

// Lista de subastas. No arranca el reloj de la sala (startClockIfLive = false).
router.get('/', async (req, res) => {
  const db = getDatabase();
  const { estado, categoria } = req.query;

  const ids = await db.prepare('SELECT identificador FROM subastas ORDER BY identificador ASC').all();
  const salas = await Promise.all(
    ids.map(({ identificador }) => computeSala(db, identificador, { startClockIfLive: false }))
  );
  let auctions = salas.filter(Boolean).map((sala) => sala.auction);

  if (categoria) {
    auctions = auctions.filter((auction) => auction.categoria === categoria);
  }
  if (estado) {
    auctions = auctions.filter((auction) => auction.estado === estado);
  }

  const statusOrder = { abierta: 1, proxima: 2, finalizada: 3 };
  auctions.sort((a, b) => {
    const byStatus = (statusOrder[a.estado] || 9) - (statusOrder[b.estado] || 9);
    if (byStatus !== 0) return byStatus;
    return String(a.fechaInicio || a.fecha || '').localeCompare(String(b.fechaInicio || b.fecha || ''));
  });

  return res.json({ auctions });
});

// Detalle de una subasta + sus lotes (items del catalogo). No arranca el reloj.
router.get('/:id', attachUser, async (req, res) => {
  const db = getDatabase();
  const sala = await computeSala(db, req.params.id, { startClockIfLive: false });

  if (!sala) {
    return res.status(404).json({ message: 'Subasta no encontrada' });
  }

  const lots = sala.items.map((item) => mapLot(sala.auction.id, item));

  return res.json({
    auction: sala.auction,
    lots,
    priceVisible: Boolean(req.user),
  });
});

// Ingresar a la sala (conectarse como asistente). Arranca el reloj si corresponde.
router.post('/:id/ingresar', requireAuth, async (req, res) => {
  const db = getDatabase();
  const sala = await computeSala(db, req.params.id, { startClockIfLive: true });

  if (!sala) {
    return res.status(404).json({ message: 'Subasta no encontrada' });
  }

  const auction = sala.auction;
  if (auction.estado === 'proxima') {
    return res.status(403).json({ message: 'La subasta todavía no está abierta' });
  }
  if (auction.estado === 'finalizada') {
    return res.status(403).json({ message: 'La subasta ya finalizó y no permite nuevas pujas' });
  }

  const accessError = validateAuctionAccess({
    user: req.user,
    auction,
    otherLiveAuction: await getOtherLiveAuction(db, req.user.id, auction.id),
    requireVerifiedPayment: false,
    verifiedPaymentCount: 0,
  });

  if (accessError) {
    return res.status(accessError.status).json({ message: accessError.message });
  }

  const attendance = await getOrCreateAsistente(db, req.user.id, auction.id);
  const verifiedPaymentCount = await getVerifiedPaymentCount(db, req.user.id);
  return res.json({
    message: 'Ingreso permitido',
    attendance,
    id_subasta: Number(auction.id),
    ingreso_permitido: true,
    habilitado_para_pujar: verifiedPaymentCount > 0,
    modo_observador: verifiedPaymentCount < 1,
  });
});

// Estado de la sala en vivo (articulo actual, mejor puja, ultimas pujas, tiempo).
router.get('/:id/estado', requireAuth, async (req, res) => {
  const db = getDatabase();

  // Primero validamos acceso con el estado actual, sin arrancar el reloj.
  const preview = await computeSala(db, req.params.id, { startClockIfLive: false });
  if (!preview) {
    return res.status(404).json({ message: 'Subasta no encontrada' });
  }

  const accessError = validateAuctionAccess({
    user: req.user,
    auction: preview.auction,
    otherLiveAuction:
      preview.auction.estado === 'finalizada' ? null : await getOtherLiveAuction(db, req.user.id, preview.auction.id),
    requireVerifiedPayment: false, // mirar la sala no exige medio de pago
    verifiedPaymentCount: await getVerifiedPaymentCount(db, req.user.id),
  });

  if (accessError) {
    return res.status(accessError.status).json({ message: accessError.message });
  }

  const status = await buildAuctionStatus(db, req.params.id, req.user.id);
  if (!status) {
    return res.status(404).json({ message: 'No hay lote activo para esta subasta' });
  }

  return res.json(status);
});

// Registrar una puja sobre el articulo en curso (pujos).
router.post('/:id/pujar', requireAuth, async (req, res) => {
  const db = getDatabase();
  const { lote_id: lotId, medio_pago_id: paymentMethodId, monto } = req.body;

  if (!lotId || !paymentMethodId || monto === undefined) {
    return res.status(422).json({ message: 'Lote, medio de pago y monto son obligatorios' });
  }

  const sala = await computeSala(db, req.params.id, { startClockIfLive: true });
  if (!sala) {
    return res.status(404).json({ message: 'Subasta no encontrada' });
  }

  const auction = sala.auction;
  if (auction.estado === 'proxima') {
    return res.status(403).json({ message: 'La subasta todavía no está abierta' });
  }
  if (auction.estado === 'finalizada') {
    return res.status(409).json({ message: 'La subasta ya finalizó. No se aceptan nuevas pujas.' });
  }

  const currentItem = sala.currentItem;
  if (!currentItem) {
    return res.status(409).json({ message: 'No hay un artículo en subasta en este momento' });
  }
  if (Number(lotId) !== Number(currentItem.id)) {
    return res.status(409).json({ message: 'Ese artículo ya no se está subastando. Actualizá la sala.' });
  }

  const bidAmount = Number(monto);

  const bidResult = await db.transaction(async (tx) => {
    {
      const lockedItem = await lockAuctionItemForBid(tx, currentItem.id, auction.id);
      if (!lockedItem) {
        return {
          validationError: {
            status: 409,
            message: 'Ese articulo ya no esta disponible en esta subasta. Actualiza la sala.',
          },
        };
      }

      const activeLotCheck = await getActiveLotIdForBid(tx, lockedItem);
      if (activeLotCheck.validationError) {
        return { validationError: activeLotCheck.validationError };
      }

      if (
        Number(activeLotCheck.activeLotId) !== Number(lotId) ||
        Number(lockedItem.id) !== Number(lotId)
      ) {
        return {
          validationError: {
            status: 409,
            message: 'Ese articulo ya no se esta subastando. Actualiza la sala.',
          },
        };
      }

      const refreshedUser = await loadUserByPersonaId(tx, req.user.id);
      if (!refreshedUser) {
        return { validationError: { status: 401, message: 'Usuario no autenticado' } };
      }

      const transactionalAuction = {
        id: Number(lockedItem.auctionId),
        categoria: lockedItem.categoria,
        moneda: lockedItem.moneda || 'ARS',
      };

      const transactionalAccessError = validateAuctionAccess({
        user: refreshedUser,
        auction: transactionalAuction,
        otherLiveAuction: await getOtherLiveAuction(tx, refreshedUser.id, transactionalAuction.id),
        requireVerifiedPayment: true,
        verifiedPaymentCount: await getVerifiedPaymentCount(tx, refreshedUser.id),
      });

      if (transactionalAccessError) {
        return { validationError: transactionalAccessError };
      }

      const transactionPayment = await getMedioPago(tx, paymentMethodId, refreshedUser.id);
      const transactionLot = { precioBase: lockedItem.precioBase };
      const transactionBest = await getBestPujoForItem(tx, lockedItem.id);
      const transactionBestAmount = transactionBest
        ? Number(transactionBest.monto)
        : Number(lockedItem.precioBase);

      if (transactionBest && Number(transactionBest.userId) === Number(refreshedUser.id)) {
        return { selfConflict: true };
      }

      const transactionBidError = validateBid({
        amount: monto,
        auction: transactionalAuction,
        lot: transactionLot,
        currentBestBid: transactionBestAmount,
        paymentMethod: transactionPayment,
      });
      if (transactionBidError) {
        return { validationError: transactionBidError };
      }

      if (transactionPayment?.tipo === 'cheque_certificado' && transactionPayment.montoGarantia) {
        const wonTotal = await getWonTotalForPaymentMethod(tx, paymentMethodId, refreshedUser.id);
        if (wonTotal + bidAmount > Number(transactionPayment.montoGarantia)) {
          return {
            validationError: {
              status: 403,
              message: 'El cheque certificado no cubre el total acumulado de compras ganadas y esta oferta',
            },
          };
        }
      }

      const transactionAssistant = await getOrCreateAsistente(
        tx,
        refreshedUser.id,
        transactionalAuction.id
      );
      const insertResult = await tx
        .prepare('INSERT INTO pujos (asistente, item, importe) VALUES (?, ?, ?) RETURNING "identificador"')
        .run(transactionAssistant.identificador, lockedItem.id, bidAmount);
      const transactionBidId = insertResult.lastInsertRowid;

      await tx
        .prepare(
          `INSERT INTO "app_pujaMedioPago" ("pujo", "medioPago", "cliente", "moneda", "monto")
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(transactionBidId, paymentMethodId, refreshedUser.id, transactionalAuction.moneda, bidAmount);

      await insertMensaje(
        tx,
        refreshedUser.id,
        'Puja registrada',
        `Tu oferta de ${bidAmount.toFixed(2)} ${transactionalAuction.moneda} fue registrada para "${lockedItem.titulo}".`,
        'mensaje'
      );

      return {
        amount: bidAmount,
        auctionId: transactionalAuction.id,
        id: transactionBidId,
        lotId: Number(lockedItem.id),
        paymentMethodId: Number(paymentMethodId),
      };
    }

  });

  if (bidResult.selfConflict) {
    return res.status(409).json({ message: 'Ya tenés la mejor oferta actual. No podés superarte a vos mismo.' });
  }
  if (bidResult.validationError) {
    return res.status(bidResult.validationError.status).json({ message: bidResult.validationError.message });
  }

  return res.status(201).json({
    message: 'Puja registrada correctamente',
    bidId: bidResult.id,
    id_puja: bidResult.id,
    id_subasta: bidResult.auctionId,
    lote_id: bidResult.lotId,
    medio_pago_id: bidResult.paymentMethodId,
    monto: bidResult.amount,
    estado_puja: 'registrada',
  });
});

module.exports = router;
