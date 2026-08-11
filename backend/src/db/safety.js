const { env, isLocalDatabaseHost, parseDatabaseUrl } = require('../config/env');

const assertSafeDatabaseReset = (config = env) => {
  if (!config.ALLOW_DB_RESET) {
    throw new Error('Refusing to reset database because ALLOW_DB_RESET is not true.');
  }

  const parsed = parseDatabaseUrl(config.DATABASE_URL);
  if (!isLocalDatabaseHost(parsed.host)) {
    throw new Error(`Refusing to reset a non-local database host: ${parsed.host}`);
  }

  if (config.NODE_ENV === 'test' && !/test/i.test(parsed.database)) {
    throw new Error(`Refusing to run destructive tests against non-test database: ${parsed.database}`);
  }

  return true;
};

module.exports = {
  assertSafeDatabaseReset,
};
