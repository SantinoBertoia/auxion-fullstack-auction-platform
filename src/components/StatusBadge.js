import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../constants/theme';
import { formatBadgeLabel } from '../utils/formatters';

const badgeColors = {
  abierta: colors.success,
  proxima: colors.accent,
  finalizada: colors.muted,
  cerrada: colors.muted,
  aprobado: colors.success,
  aprobada: colors.success,
  en_revision: colors.warning,
  rechazado: colors.danger,
  rechazada: colors.danger,
  aceptado: colors.accent,
  plata: colors.primary,
  oro: colors.warning,
  platino: colors.text,
  ganada: colors.success,
  superada: colors.muted,
  participando: colors.accent,
  verificado: colors.success,
  pendiente: colors.warning,
  propuesta: colors.accent,
  en_subasta: colors.primary,
  vendido: colors.success,
  condiciones_propuestas: colors.accent,
  condiciones_aceptadas: colors.success,
  condiciones_rechazadas: colors.danger,
  comun: colors.muted,
  especial: colors.accent,
};

export default function StatusBadge({ label }) {
  const value = String(label || '').toLowerCase();
  const backgroundColor = badgeColors[value] || colors.muted;

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={styles.text}>{formatBadgeLabel(label)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  text: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
});
