const express = require('express');
const cors = require('cors');

const { env } = require('./src/config/env');
const { getDatabase, initializeDatabase } = require('./src/db/database');
const { seedIfEmpty } = require('./src/db/seed');
const { startRegistrationReviewJob } = require('./src/services/registrationFlow');
const userRoutes = require('./src/routes/users');
const auctionRoutes = require('./src/routes/auctions');
const lotRoutes = require('./src/routes/lots');
const articleRoutes = require('./src/routes/articles');

const createCorsOptions = () => ({
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by CORS'));
  },
});

const createApp = () => {
  const app = express();

  app.use(cors(createCorsOptions()));
  app.use(express.json());

  app.get('/api/health', async (req, res) => {
    try {
      await getDatabase().prepare('SELECT 1 AS ok').get();
      res.json({ ok: true, database: 'connected', message: 'Auxion API is healthy' });
    } catch (error) {
      res.status(503).json({ ok: false, database: 'unavailable', message: 'Database healthcheck failed' });
    }
  });

  app.use('/api/usuarios', userRoutes);
  app.use('/api/subastas', auctionRoutes);
  app.use('/api/lotes', lotRoutes);
  app.use('/api/articulos', articleRoutes);

  app.use((req, res) => {
    res.status(404).json({ message: 'Recurso no encontrado' });
  });

  app.use((error, req, res, next) => {
    if (error && (error.type === 'entity.parse.failed' || error instanceof SyntaxError) && 'body' in error) {
      return res.status(400).json({ message: 'El cuerpo de la peticion no es un JSON valido' });
    }
    if (error && error.message === 'Origin is not allowed by CORS') {
      return res.status(403).json({ message: 'Origin is not allowed by CORS' });
    }
    console.error(error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  });

  return app;
};

const start = async () => {
  const db = await initializeDatabase();
  if (env.AUTO_SEED_ON_START && (await seedIfEmpty(db))) {
    console.log('Base vacia: se cargaron los datos de prueba (seed).');
  }
  if (env.ENABLE_REGISTRATION_REVIEW_JOB) {
    startRegistrationReviewJob(db);
  }

  const app = createApp();
  return app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Auxion API listening on port ${env.PORT} (/api)`);
  });
};

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  createApp,
  start,
};
