const jwt = require('jsonwebtoken');
const { getDatabase } = require('../db/database');
const { loadUserByPersonaId } = require('../db/repository');
const { env } = require('../config/env');

const JWT_SECRET = env.JWT_SECRET;

const readToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7);
};

// El payload del token lleva { id: personaId, email }. req.user queda con el
// usuario combinado (persona + cliente + credenciales).
const attachUser = async (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = getDatabase();
    req.user = await loadUserByPersonaId(db, payload.id);
  } catch (error) {
    req.user = null;
  }

  return next();
};

const requireAuth = async (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Usuario no autenticado' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = getDatabase();
    const user = await loadUserByPersonaId(db, payload.id);
    if (!user) {
      return res.status(401).json({ message: 'Usuario no autenticado' });
    }
    // Cuenta inhabilitada (personas.estado = 'inactivo'): invalida el token en
    // cualquier endpoint protegido, igual que el corte de /login.
    if (user.blocked) {
      return res.status(403).json({ message: 'La cuenta esta inhabilitada. Contacte a la empresa.' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Token invalido o vencido' });
  }
};

const requireBackoffice = (req, res, next) => {
  if (!req.user?.esEmpleado) {
    return res.status(403).json({ message: 'Permisos de back-office requeridos' });
  }

  return next();
};

module.exports = {
  JWT_SECRET,
  attachUser,
  requireBackoffice,
  requireAuth,
};
