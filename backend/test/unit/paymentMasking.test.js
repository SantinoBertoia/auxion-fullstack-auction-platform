const test = require('node:test');
const assert = require('node:assert/strict');

const { maskPaymentNumber, publicPayment } = require('../../src/db/repository');

test('maskPaymentNumber masks card, account and check references', () => {
  assert.equal(maskPaymentNumber('4111111111111111', 'tarjeta'), '**** **** **** 1111');
  assert.equal(maskPaymentNumber('000123456789', 'cuenta_bancaria'), 'Account ending 6789');
  assert.equal(maskPaymentNumber('CHK-2026-88', 'cheque_certificado'), 'Check ending 6-88');
});

test('publicPayment never exposes the raw payment number', () => {
  const payment = publicPayment({
    id: 1,
    tipo: 'tarjeta',
    alias: 'Personal card',
    moneda: 'USD',
    numero: '4111111111111111',
  });

  assert.equal(payment.numero, '**** **** **** 1111');
  assert.equal(payment.numeroEnmascarado, '**** **** **** 1111');
});
