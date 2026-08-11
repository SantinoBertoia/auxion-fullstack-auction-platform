const allowedPaymentTypes = ['tarjeta', 'cuenta_bancaria', 'cheque_certificado'];
const allowedCurrencies = ['ARS', 'USD'];

const trimText = (value) => String(value || '').trim();

const normalizeAmount = (value) => {
  if (value === null || value === undefined || trimText(value) === '') {
    return null;
  }
  return Number(trimText(value).replace(',', '.'));
};

const normalizePaymentPayload = (payload = {}) => ({
  tipo: trimText(payload.tipo).toLowerCase(),
  alias: trimText(payload.alias),
  moneda: trimText(payload.moneda).toUpperCase(),
  numero: trimText(payload.numero),
  banco: trimText(payload.banco),
  montoGarantia: payload.montoGarantia ?? payload.monto_garantia ?? null,
});

const validatePaymentPayload = (payload = {}) => {
  const payment = normalizePaymentPayload(payload);

  if (!payment.tipo) {
    return { error: 'El tipo de medio de pago es obligatorio' };
  }
  if (!allowedPaymentTypes.includes(payment.tipo)) {
    return { error: 'El tipo de medio de pago no es valido' };
  }
  if (!payment.alias) {
    return { error: 'El alias del medio de pago es obligatorio' };
  }
  if (payment.alias.length < 3) {
    return { error: 'El alias del medio de pago debe tener al menos 3 caracteres' };
  }
  if (!payment.moneda) {
    return { error: 'La moneda del medio de pago es obligatoria' };
  }
  if (!allowedCurrencies.includes(payment.moneda)) {
    return { error: 'La moneda del medio de pago debe ser ARS o USD' };
  }
  if (!payment.numero) {
    return { error: 'El numero o referencia del medio de pago es obligatorio' };
  }

  const amount = normalizeAmount(payment.montoGarantia);

  if (payment.tipo === 'tarjeta') {
    if (!/^\d+$/.test(payment.numero)) {
      return { error: 'El numero de tarjeta debe contener solo numeros' };
    }
    if (payment.numero.length < 13 || payment.numero.length > 19) {
      return { error: 'El numero de tarjeta debe tener entre 13 y 19 digitos' };
    }
  }

  if (payment.tipo === 'cuenta_bancaria') {
    if (!payment.banco) {
      return { error: 'El banco es obligatorio para cuenta bancaria' };
    }
    if (!/^[A-Za-z0-9-]+$/.test(payment.numero)) {
      return { error: 'El numero de cuenta debe usar solo letras, numeros y guiones' };
    }
    if (payment.numero.length < 6) {
      return { error: 'El numero de cuenta debe tener al menos 6 caracteres' };
    }
  }

  if (payment.tipo === 'cheque_certificado') {
    if (!payment.banco) {
      return { error: 'El banco es obligatorio para cheque certificado' };
    }
    if (!/^[A-Za-z0-9-]+$/.test(payment.numero)) {
      return { error: 'El numero de cheque debe usar solo letras, numeros y guiones' };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'El monto de garantia debe ser numerico y mayor a 0' };
    }
  }

  return {
    payment: {
      ...payment,
      banco: payment.banco || null,
      montoGarantia: payment.tipo === 'cheque_certificado' ? amount : null,
    },
  };
};

module.exports = {
  allowedPaymentTypes,
  allowedCurrencies,
  normalizePaymentPayload,
  validatePaymentPayload,
};
