const { initializeDatabase, getDatabase } = require('./database');

(async () => {
  await initializeDatabase();
  console.log('Database schema is ready.');
  await getDatabase().close();
})().catch((error) => {
  const details = [error.message, error.code, error.cause?.message]
    .filter(Boolean)
    .join(' ');
  console.error('Database migration failed:', details || String(error));
  process.exit(1);
});
