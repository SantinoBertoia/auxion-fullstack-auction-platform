const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: false, quiet: true });

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:19006',
  'http://localhost:8081',
  'http://localhost:3000',
  'http://127.0.0.1:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:3000',
];

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);

const trim = (value) => String(value || '').trim();

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || trim(value) === '') return defaultValue;
  return ['1', 'true', 'yes', 'si', 'on'].includes(trim(value).toLowerCase());
};

const parseInteger = (value, defaultValue, { min = 1, name = 'value' } = {}) => {
  if (value === undefined || value === null || trim(value) === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}`);
  }
  return parsed;
};

const parseList = (value, defaultValue = []) => {
  if (!value) return defaultValue;
  return trim(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseDatabaseUrl = (databaseUrl) => {
  try {
    const parsed = new URL(databaseUrl);
    return {
      database: parsed.pathname.replace(/^\//, ''),
      host: parsed.hostname,
      protocol: parsed.protocol,
    };
  } catch (error) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string');
  }
};

const isLocalDatabaseHost = (host) => LOCAL_DATABASE_HOSTS.has(trim(host).toLowerCase());

const isLocalDatabaseUrl = (databaseUrl) => {
  const parsed = parseDatabaseUrl(databaseUrl);
  return isLocalDatabaseHost(parsed.host);
};

const requireValue = (raw, name) => {
  const value = trim(raw[name]);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const requireSecret = (raw, name, minLength = 32) => {
  const value = requireValue(raw, name);
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters long`);
  }
  return value;
};

const buildEnv = (raw = process.env) => {
  const NODE_ENV = trim(raw.NODE_ENV) || 'development';
  const DATABASE_URL = requireValue(raw, 'DATABASE_URL');
  const parsedDatabase = parseDatabaseUrl(DATABASE_URL);
  const MAIL_TRANSPORT = trim(raw.MAIL_TRANSPORT) || (NODE_ENV === 'production' ? 'auto' : 'console');

  if (!['postgres:', 'postgresql:'].includes(parsedDatabase.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol');
  }
  if (!['auto', 'console', 'smtp', 'resend', 'brevo'].includes(MAIL_TRANSPORT)) {
    throw new Error('MAIL_TRANSPORT must be one of: auto, console, smtp, resend, brevo');
  }

  return Object.freeze({
    NODE_ENV,
    PORT: parseInteger(raw.PORT, 3000, { name: 'PORT' }),
    DATABASE_URL,
    DATABASE_HOST: parsedDatabase.host,
    DATABASE_NAME: parsedDatabase.database,
    DATABASE_SSL: parseBoolean(raw.DATABASE_SSL, !isLocalDatabaseHost(parsedDatabase.host)),
    PG_POOL_MAX: parseInteger(raw.PG_POOL_MAX, 8, { name: 'PG_POOL_MAX' }),
    JWT_SECRET: requireSecret(raw, 'JWT_SECRET'),
    CORS_ORIGINS: parseList(raw.CORS_ORIGINS, DEFAULT_CORS_ORIGINS),
    ALLOW_DB_RESET: parseBoolean(raw.ALLOW_DB_RESET, false),
    AUTO_SEED_ON_START: parseBoolean(raw.AUTO_SEED_ON_START, false),
    ENABLE_REGISTRATION_REVIEW_JOB: parseBoolean(raw.ENABLE_REGISTRATION_REVIEW_JOB, true),
    AUTO_VERIFY_PAYMENT_FOR_DEMO: parseBoolean(raw.AUTO_VERIFY_PAYMENT_FOR_DEMO, false),
    REGISTRATION_REVIEW_MINUTES: parseInteger(raw.REGISTRATION_REVIEW_MINUTES, 30, {
      min: 0,
      name: 'REGISTRATION_REVIEW_MINUTES',
    }),
    PASSWORD_RESET_TOKEN_MINUTES: parseInteger(raw.PASSWORD_RESET_TOKEN_MINUTES, 30, {
      min: 1,
      name: 'PASSWORD_RESET_TOKEN_MINUTES',
    }),
    MAIL_TRANSPORT,
    BREVO_API_KEY: trim(raw.BREVO_API_KEY),
    RESEND_API_KEY: trim(raw.RESEND_API_KEY),
    RESEND_FROM: trim(raw.RESEND_FROM),
    SMTP_HOST: trim(raw.SMTP_HOST),
    SMTP_PORT: trim(raw.SMTP_PORT),
    SMTP_USER: trim(raw.SMTP_USER),
    SMTP_PASS: trim(raw.SMTP_PASS),
    MAIL_FROM: trim(raw.MAIL_FROM),
    DEMO_IMAGE_BASE_URL: trim(raw.DEMO_IMAGE_BASE_URL).replace(/\/+$/, ''),
  });
};

const env = buildEnv();

module.exports = {
  DEFAULT_CORS_ORIGINS,
  LOCAL_DATABASE_HOSTS,
  buildEnv,
  env,
  isLocalDatabaseHost,
  isLocalDatabaseUrl,
  parseBoolean,
  parseDatabaseUrl,
};
