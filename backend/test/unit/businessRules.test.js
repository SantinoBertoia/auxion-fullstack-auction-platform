const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateBidLimits,
  validateAuctionAccess,
  validateBid,
} = require('../../src/utils/businessRules');

const baseUser = {
  id: 1,
  esCliente: true,
  blocked: false,
  estadoPersona: 'activo',
  admitido: 'si',
  categoria: 'plata',
};

const baseAuction = {
  id: 10,
  categoria: 'plata',
  moneda: 'USD',
};

const verifiedPayment = {
  id: 1,
  tipo: 'tarjeta',
  moneda: 'USD',
  verificado: 1,
};

test('validateAuctionAccess accepts an admitted user with enough category', () => {
  const result = validateAuctionAccess({
    user: baseUser,
    auction: baseAuction,
    otherLiveAuction: null,
    requireVerifiedPayment: true,
    verifiedPaymentCount: 1,
  });

  assert.equal(result, null);
});

test('validateAuctionAccess rejects users without category, admission, payment or account status', () => {
  assert.equal(
    validateAuctionAccess({
      user: { ...baseUser, categoria: null },
      auction: baseAuction,
      otherLiveAuction: null,
      requireVerifiedPayment: false,
      verifiedPaymentCount: 0,
    }).status,
    403
  );

  assert.equal(
    validateAuctionAccess({
      user: { ...baseUser, admitido: 'no' },
      auction: baseAuction,
      otherLiveAuction: null,
      requireVerifiedPayment: false,
      verifiedPaymentCount: 0,
    }).status,
    403
  );

  assert.equal(
    validateAuctionAccess({
      user: { ...baseUser, blocked: true },
      auction: baseAuction,
      otherLiveAuction: null,
      requireVerifiedPayment: false,
      verifiedPaymentCount: 0,
    }).status,
    403
  );

  assert.equal(
    validateAuctionAccess({
      user: { ...baseUser, estadoPersona: 'inactivo' },
      auction: baseAuction,
      otherLiveAuction: null,
      requireVerifiedPayment: false,
      verifiedPaymentCount: 0,
    }).status,
    403
  );

  assert.equal(
    validateAuctionAccess({
      user: baseUser,
      auction: baseAuction,
      otherLiveAuction: null,
      requireVerifiedPayment: true,
      verifiedPaymentCount: 0,
    }).status,
    403
  );
});

test('validateAuctionAccess rejects simultaneous live auction participation', () => {
  const result = validateAuctionAccess({
    user: baseUser,
    auction: baseAuction,
    otherLiveAuction: 99,
    requireVerifiedPayment: false,
    verifiedPaymentCount: 0,
  });

  assert.equal(result.status, 409);
});

test('validateBid enforces minimum and maximum bid limits', () => {
  const limits = calculateBidLimits({
    auctionCategory: 'plata',
    basePrice: 10000,
    currentBestBid: 10000,
  });
  assert.equal(limits.minimum, 10100);
  assert.equal(limits.maximum, 12000);

  assert.equal(
    validateBid({
      amount: 10099,
      auction: baseAuction,
      lot: { precioBase: 10000 },
      currentBestBid: 10000,
      paymentMethod: verifiedPayment,
    }).status,
    400
  );

  assert.equal(
    validateBid({
      amount: 12001,
      auction: baseAuction,
      lot: { precioBase: 10000 },
      currentBestBid: 10000,
      paymentMethod: verifiedPayment,
    }).status,
    400
  );
});

test('validateBid rejects invalid payment states and currency mismatches', () => {
  assert.equal(
    validateBid({
      amount: 10100,
      auction: baseAuction,
      lot: { precioBase: 10000 },
      currentBestBid: 10000,
      paymentMethod: null,
    }).status,
    403
  );

  assert.equal(
    validateBid({
      amount: 10100,
      auction: baseAuction,
      lot: { precioBase: 10000 },
      currentBestBid: 10000,
      paymentMethod: { ...verifiedPayment, verificado: 0 },
    }).status,
    403
  );

  assert.equal(
    validateBid({
      amount: 10100,
      auction: baseAuction,
      lot: { precioBase: 10000 },
      currentBestBid: 10000,
      paymentMethod: { ...verifiedPayment, moneda: 'ARS' },
    }).status,
    403
  );
});

test('validateBid rejects certified checks with insufficient guarantee', () => {
  const result = validateBid({
    amount: 12000,
    auction: baseAuction,
    lot: { precioBase: 10000 },
    currentBestBid: 10000,
    paymentMethod: {
      id: 3,
      tipo: 'cheque_certificado',
      moneda: 'USD',
      verificado: 1,
      montoGarantia: 11000,
    },
  });

  assert.equal(result.status, 403);
});
