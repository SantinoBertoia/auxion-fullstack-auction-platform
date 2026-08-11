const categoryLabels = {
  comun: 'Común',
  especial: 'Especial',
  plata: 'Plata',
  oro: 'Oro',
  platino: 'Platino',
};

const statusLabels = {
  en_revision: 'En revisión',
  aprobado: 'Aprobado',
  aprobada: 'Aprobada',
  rechazado: 'Rechazado',
  rechazada: 'Rechazada',
  proxima: 'Próxima',
  abierta: 'Abierta',
  finalizada: 'Finalizada',
  cerrada: 'Finalizada',
  verificado: 'Verificado',
  pendiente: 'Pendiente',
};

const paymentTypeLabels = {
  tarjeta: 'Tarjeta',
  cuenta_bancaria: 'Cuenta bancaria',
  cheque_certificado: 'Cheque certificado',
};

const articleStatusLabels = {
  propuesta: 'Propuesta',
  en_revision: 'En revisión',
  aprobado: 'Aprobado',
  rechazada: 'Rechazada',
  rechazado: 'Rechazado',
  en_subasta: 'En subasta',
  vendido: 'Vendido',
  aceptado: 'Condiciones propuestas',
  condiciones_propuestas: 'Condiciones propuestas',
  condiciones_aceptadas: 'Condiciones aceptadas',
  condiciones_rechazadas: 'Condiciones rechazadas',
};

const bidResultLabels = {
  ganada: 'Ganada',
  superada: 'Superada',
  participando: 'Participando',
};

function readableFallback(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const normalized = text.replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatFromMap(map, value) {
  const key = String(value || '').toLowerCase();
  return map[key] || readableFallback(value);
}

export const formatCategory = (value) => formatFromMap(categoryLabels, value);

export const formatStatus = (value) => formatFromMap(statusLabels, value);

export const formatPaymentType = (value) => formatFromMap(paymentTypeLabels, value);

export const formatArticleStatus = (value) => formatFromMap(articleStatusLabels, value);

export const formatBidResult = (value) => formatFromMap(bidResultLabels, value);

export const formatBadgeLabel = (value) =>
  formatFromMap(
    {
      ...categoryLabels,
      ...statusLabels,
      ...paymentTypeLabels,
      ...articleStatusLabels,
      ...bidResultLabels,
    },
    value,
  );
