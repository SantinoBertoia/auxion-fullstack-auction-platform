// Reglas de negocio puras (sin acceso a base de datos). Operan sobre objetos ya
// mapeados desde el modelo relacional:
//   - user:   { id, estadoPersona, admitido, categoria }   (personas + clientes)
//   - auction:{ id, categoria, moneda }                     (subastas + runtime)
//   - lot:    { precioBase }                                (itemsCatalogo)
//   - paymentMethod: { verificado, moneda, tipo, montoGarantia }  (app_mediosPago)

const categoryOrder = ['comun', 'especial', 'plata', 'oro', 'platino'];

const ESTADO_PERSONA_INACTIVO = 'inactivo';
const ESTADO_SUBASTA_CERRADA = 'cerrada';
const ESTADO_SUBASTA_ABIERTA = 'abierta';

const hasEnoughCategory = (userCategory, auctionCategory) => {
  return categoryOrder.indexOf(userCategory) >= categoryOrder.indexOf(auctionCategory);
};

// Limites de incremento de puja definidos para las subastas comunes:
//  - minimo: ultima oferta + 1% del precio base.
//  - maximo: ultima oferta + 20% del precio base.
//  - no aplican a categorias oro y platino.
const calculateBidLimits = ({ auctionCategory, basePrice, currentBestBid }) => {
  const current = Number(currentBestBid || basePrice || 0);
  const base = Number(basePrice || 0);

  if (auctionCategory === 'oro' || auctionCategory === 'platino') {
    return {
      minimum: current,
      maximum: null,
      appliesRange: false,
    };
  }

  return {
    minimum: current + base * 0.01,
    maximum: current + base * 0.2,
    appliesRange: true,
  };
};

const validateAuctionAccess = ({
  user,
  auction,
  otherLiveAuction,
  requireVerifiedPayment,
  verifiedPaymentCount,
}) => {
  if (!user) {
    return { status: 401, message: 'Usuario no autenticado' };
  }

  // personas.estado = 'inactivo' => cuenta inhabilitada.
  if (user.blocked || user.estadoPersona === ESTADO_PERSONA_INACTIVO) {
    return { status: 403, message: 'La cuenta está inhabilitada para participar' };
  }

  if (!user.esCliente) {
    return { status: 403, message: 'El usuario no está registrado como postor' };
  }

  // clientes.admitido = 'si' => aprobado por la empresa.
  if (user.admitido !== 'si') {
    return { status: 403, message: 'El usuario todavía no fue admitido por la empresa' };
  }

  if (!hasEnoughCategory(user.categoria, auction.categoria)) {
    return { status: 403, message: 'Categoría insuficiente para esta subasta' };
  }

  // Un usuario no puede estar conectado en vivo a mas de una subasta a la vez.
  if (otherLiveAuction && Number(otherLiveAuction) !== Number(auction.id)) {
    return { status: 409, message: 'El usuario ya está conectado a otra subasta' };
  }

  if (requireVerifiedPayment && verifiedPaymentCount < 1) {
    return { status: 403, message: 'El usuario no tiene un medio de pago verificado' };
  }

  return null;
};

const validateBid = ({ amount, auction, lot, currentBestBid, paymentMethod }) => {
  const parsedAmount = Number(amount);

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return { status: 400, message: 'El monto de la puja es inválido' };
  }

  if (!paymentMethod) {
    return { status: 403, message: 'Seleccioná un medio de pago válido' };
  }

  if (!paymentMethod.verificado) {
    return { status: 403, message: 'El medio de pago no está verificado' };
  }

  if (paymentMethod.moneda !== auction.moneda) {
    return { status: 403, message: 'El medio de pago no coincide con la moneda de la subasta' };
  }

  const best = Number(currentBestBid || lot.precioBase);
  if (parsedAmount <= best) {
    return { status: 409, message: 'La oferta ya fue superada por otra puja' };
  }

  const limits = calculateBidLimits({
    auctionCategory: auction.categoria,
    basePrice: lot.precioBase,
    currentBestBid: best,
  });

  if (parsedAmount < limits.minimum) {
    return {
      status: 400,
      message: `La puja mínima permitida es ${limits.minimum.toFixed(2)} ${auction.moneda}`,
    };
  }

  if (limits.maximum !== null && parsedAmount > limits.maximum) {
    return {
      status: 400,
      message: `La puja máxima permitida es ${limits.maximum.toFixed(2)} ${auction.moneda}`,
    };
  }

  // El cheque certificado funciona como garantia: las compras no pueden superar
  // el monto certificado y verificado antes de la subasta.
  if (
    paymentMethod.tipo === 'cheque_certificado' &&
    paymentMethod.montoGarantia &&
    parsedAmount > Number(paymentMethod.montoGarantia)
  ) {
    return { status: 403, message: 'El cheque certificado no cubre el monto ofertado' };
  }

  return null;
};

module.exports = {
  categoryOrder,
  ESTADO_PERSONA_INACTIVO,
  ESTADO_SUBASTA_CERRADA,
  ESTADO_SUBASTA_ABIERTA,
  hasEnoughCategory,
  calculateBidLimits,
  validateAuctionAccess,
  validateBid,
};
