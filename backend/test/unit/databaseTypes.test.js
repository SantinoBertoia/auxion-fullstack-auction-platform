process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/auxion_test';
process.env.JWT_SECRET = 'unit-test-secret-with-at-least-32-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const { types } = require('pg');

require('../../src/db/database');

test('PostgreSQL numeric values are parsed as JavaScript numbers for API responses', () => {
  const parseNumeric = types.getTypeParser(1700, 'text');

  assert.equal(parseNumeric('10100.50'), 10100.5);
});
