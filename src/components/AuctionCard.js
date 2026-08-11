import { Image, StyleSheet, Text, View } from 'react-native';

import AppButton from './AppButton';
import { colors, radius, spacing, typography } from '../constants/theme';
import StatusBadge from './StatusBadge';
import { formatCategory } from '../utils/formatters';

export default function AuctionCard({ auction, onPress }) {
  return (
    <View style={styles.card}>
      {auction.imagenUrl ? (
        <Image source={{ uri: auction.imagenUrl }} style={styles.banner} resizeMode="cover" />
      ) : null}
      <View style={styles.header}>
        <Text style={styles.title}>{auction.titulo}</Text>
        <StatusBadge label={auction.estado} />
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.icon}>📅</Text>
        <Text style={styles.meta}>{auction.fecha}, {auction.hora} hs</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.icon}>🏷️</Text>
        <Text style={styles.meta}>{formatCategory(auction.categoria)} • {auction.moneda}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.icon}>📍</Text>
        <Text style={styles.meta}>{auction.ubicacion}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.icon}>👤</Text>
        <Text style={styles.meta}>{auction.rematador}</Text>
      </View>
      <AppButton onPress={onPress} title="Ver catálogo" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  banner: {
    borderRadius: radius.sm,
    height: 140,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: typography.subtitle,
    fontWeight: '800',
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  icon: {
    fontSize: 14,
    width: 20,
  },
  meta: {
    color: colors.text,
    fontSize: typography.body,
  },
});
