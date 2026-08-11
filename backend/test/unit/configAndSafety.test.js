process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/auxion_test';
process.env.JWT_SECRET = 'unit-test-secret-with-at-least-32-chars';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEnv } = require('../../src/config/env');
const { assertSafeDatabaseReset } = require('../../src/db/safety');

const validRaw = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/auxion_test',
  JWT_SECRET: 'unit-test-secret-with-at-least-32-chars',
  NODE_ENV: 'test',
  ALLOW_DB_RESET: 'true',
};

test('buildEnv validates required secrets and local database defaults', () => {
  const config = buildEnv(validRaw);

  assert.equal(config.DATABASE_SSL, false);
  assert.equal(config.PORT, 3000);
  assert.equal(config.DATABASE_NAME, 'auxion_test');
});

test('buildEnv rejects missing or short JWT secrets', () => {
  assert.throws(() => buildEnv({ ...validRaw, JWT_SECRET: '' }), /JWT_SECRET/);
  assert.throws(() => buildEnv({ ...validRaw, JWT_SECRET: 'short' }), /at least 32/);
});

test('assertSafeDatabaseReset requires explicit opt-in', () => {
  const config = buildEnv({ ...validRaw, ALLOW_DB_RESET: 'false' });

  assert.throws(() => assertSafeDatabaseReset(config), /ALLOW_DB_RESET/);
});

test('assertSafeDatabaseReset rejects remote hosts and non-test databases in test mode', () => {
  const remote = buildEnv({
    ...validRaw,
    DATABASE_URL: 'postgresql://user:pass@example.com:5432/auxion_test',
  });
  assert.throws(() => assertSafeDatabaseReset(remote), /non-local/);

  const nonTest = buildEnv({
    ...validRaw,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/auxion_local',
  });
  assert.throws(() => assertSafeDatabaseReset(nonTest), /non-test/);
});
