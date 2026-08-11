const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePaymentPayload } = require('../../src/utils/paymentRules');

test('validatePaymentPayload allows card and bank account without guarantee amount', () => {
  const card = validatePaymentPayload({
    tipo: 'tarjeta',
    alias: 'Visa demo',
    moneda: 'USD',
    numero: '4111111111111111',
  });
  assert.equal(card.error, undefined);
  assert.equal(card.payment.montoGarantia, null);

  const account = validatePaymentPayload({
    tipo: 'cuenta_bancaria',
    alias: 'Cuenta demo',
    moneda: 'ARS',
    numero: '1234567890',
    banco: 'Banco Demo',
  });
  assert.equal(account.error, undefined);
  assert.equal(account.payment.montoGarantia, null);
});

test('validatePaymentPayload requires guarantee amount for certified checks', () => {
  const missing = validatePaymentPayload({
    tipo: 'cheque_certificado',
    alias: 'Cheque demo',
    moneda: 'USD',
    numero: 'CHK-123456',
    banco: 'Banco Demo',
  });
  assert.match(missing.error, /monto de garantia/);

  const valid = validatePaymentPayload({
    tipo: 'cheque_certificado',
    alias: 'Cheque demo',
    moneda: 'USD',
    numero: 'CHK-123456',
    banco: 'Banco Demo',
    montoGarantia: '15000',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.payment.montoGarantia, 15000);
});
