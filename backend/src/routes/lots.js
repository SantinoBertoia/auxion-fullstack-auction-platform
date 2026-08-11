const express = require('express');

const { getDatabase } = require('../db/database');
const { attachUser } = require('../middleware/auth');
const { ESTADO_SUBASTA_CERRADA } = require('../utils/businessRules');

const router = express.Router();

// Detalle de un lote. Un "lote" del front es un itemsCatalogo + su producto.
router.get('/:id', attachUser, async (req, res) => {
  const db = getDatabase();
  const row = await db
    .prepare(
      `SELECT ic.identificador AS id, cat.subasta AS "auctionId", ic.producto AS producto,
        ic."precioBase" AS "precioBase",
        pr."descripcionCatalogo" AS titulo, pr."descripcionCompleta" AS descripcion,
        pr.fecha AS "fechaObjeto",
        cat.descripcion AS subasta, s.estado AS "estadoSubastaRaw", s.categoria AS categoria,
        rt.moneda AS moneda,
        r.cliente AS "winnerUserId", r.importe AS "winnerMonto",
        per.nombre AS "winnerPostor", cr.email AS "winnerEmail",
        pi.url AS "imagenUrl"
       FROM "itemsCatalogo" ic
       JOIN catalogos cat ON cat.identificador = ic.catalogo
       JOIN productos pr ON pr.identificador = ic.producto
       LEFT JOIN "app_productoImagen" pi ON pi.producto = ic.producto
       JOIN subastas s ON s.identificador = cat.subasta
       LEFT JOIN "app_subastaRuntime" rt ON rt.subasta = s.identificador
       LEFT JOIN "registroDeSubasta" r ON r.subasta = cat.subasta AND r.producto = ic.producto
       LEFT JOIN personas per ON per.identificador = r.cliente
       LEFT JOIN app_credenciales cr ON cr.persona = r.cliente
       WHERE ic.identificador = ?`
    )
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ message: 'Lote no encontrado' });
  }

  const lot = {
    id: row.id,
    auctionId: row.auctionId,
    numeroPieza: `PZA-${String(row.producto).padStart(3, '0')}`,
    titulo: row.titulo,
    descripcion: row.descripcion,
    descripcionExtra: null,
    precioBase: row.precioBase,
    artista: null,
    fechaObjeto: row.fechaObjeto || null,
    historia: null,
    imagenUrl: row.imagenUrl || null,
    subasta: row.subasta,
    estadoSubasta: row.estadoSubastaRaw === ESTADO_SUBASTA_CERRADA ? 'finalizada' : 'abierta',
    moneda: row.moneda || 'ARS',
    categoria: row.categoria,
    winner: row.winnerUserId
      ? {
          userId: row.winnerUserId,
          postor: row.winnerPostor,
          email: row.winnerEmail,
          monto: row.winnerMonto,
          moneda: row.moneda || 'ARS',
        }
      : null,
  };

  return res.json({
    lot,
    priceVisible: Boolean(req.user),
  });
});

module.exports = router;
