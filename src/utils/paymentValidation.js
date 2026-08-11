export const PAYMENT_TYPES = ['tarjeta', 'cuenta_bancaria', 'cheque_certificado'];
export const PAYMENT_CURRENCIES = ['USD', 'ARS'];

const trimText = (value) => String(value || '').trim();

const parseAmount = (value) => {
  if (value === null || value === undefined || trimText(value) === '') {
    return null;
  }
  return Number(trimText(value).replace(',', '.'));
};

export const buildPaymentPayload = (payment = {}) => ({
  tipo: trimText(payment.tipo).toLowerCase(),
  moneda: trimText(payment.moneda).toUpperCase(),
  alias: trimText(payment.alias),
  banco: trimText(payment.banco),
  numero: trimText(payment.numero),
  montoGarantia: parseAmount(payment.montoGarantia),
});

export const validatePaymentPayload = (payment = {}) => {
  const payload = buildPaymentPayload(payment);

  if (!payload.tipo) return 'El tipo de medio de pago es obligatorio';
  if (!PAYMENT_TYPES.includes(payload.tipo)) return 'El tipo de medio de pago no es valido';
  if (!payload.alias) return 'El alias del medio de pago es obligatorio';
  if (payload.alias.length < 3) return 'El alias del medio de pago debe tener al menos 3 caracteres';
  if (!payload.moneda) return 'La moneda del medio de pago es obligatoria';
  if (!PAYMENT_CURRENCIES.includes(payload.moneda)) return 'La moneda del medio de pago debe ser ARS o USD';
  if (!payload.numero) return 'El numero o referencia del medio de pago es obligatorio';

  if (payload.tipo === 'tarjeta') {
    if (!/^\d+$/.test(payload.numero)) return 'El numero de tarjeta debe contener solo numeros';
    if (payload.numero.length < 13 || payload.numero.length > 19) {
      return 'El numero de tarjeta debe tener entre 13 y 19 digitos';
    }
  }

  if (payload.tipo === 'cuenta_bancaria') {
    if (!payload.banco) return 'El banco es obligatorio para cuenta bancaria';
    if (!/^[A-Za-z0-9-]+$/.test(payload.numero)) {
      return 'El numero de cuenta debe usar solo letras, numeros y guiones';
    }
    if (payload.numero.length < 6) return 'El numero de cuenta debe tener al menos 6 caracteres';
  }

  if (payload.tipo === 'cheque_certificado') {
    if (!payload.banco) return 'El banco es obligatorio para cheque certificado';
    if (!/^[A-Za-z0-9-]+$/.test(payload.numero)) {
      return 'El numero de cheque debe usar solo letras, numeros y guiones';
    }
    if (!Number.isFinite(payload.montoGarantia) || payload.montoGarantia <= 0) {
      return 'El monto de garantia debe ser numerico y mayor a 0';
    }
  }

  return '';
};
