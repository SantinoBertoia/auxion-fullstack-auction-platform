import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';

export default function LotCard({ lot, priceVisible, moneda, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {lot.imagenUrl ? (
        <Image source={{ uri: lot.imagenUrl }} style={styles.imagePlaceholder} resizeMode="cover" />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.imageText}>{lot.numeroPieza}</Text>
        </View>
      )}
      <View style={styles.content}>
        <Text style={styles.title}>{lot.titulo}</Text>
        <Text numberOfLines={2} style={styles.description}>{lot.descripcion}</Text>
        <Text style={styles.price}>
          {priceVisible ? `Base: ${Number(lot.precioBase).toFixed(2)} ${moneda || ''}` : 'Iniciá sesión para ver el precio base'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  imagePlaceholder: {
    alignItems: 'center',
    backgroundColor: '#D9EAFB',
    borderRadius: radius.md,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  imageText: {
    color: colors.primary,
    fontWeight: '800',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  description: {
    color: colors.muted,
    fontSize: typography.small,
  },
  price: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '700',
  },
});
