import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import BottomNav from '../components/BottomNav';
import ErrorBanner from '../components/ErrorBanner';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing, typography } from '../constants/theme';

const formatWinnerAmount = (winner, fallbackCurrency) => {
  const amount = Number(winner?.monto);
  if (!Number.isFinite(amount)) {
    return null;
  }

  return `${winner.moneda || fallbackCurrency || ''} ${amount.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`.trim();
};

const buildFinishedLotMessage = (lot) => {
  const base = 'Esta subasta ya finalizó. No se pueden realizar más pujas.';
  const winner = lot?.winner || lot?.ganador;

  if (!winner) {
    return `${base}\nFinalizó sin pujas registradas.`;
  }

  const winnerName = winner.postor || winner.email || 'usuario ganador';
  const amount = formatWinnerAmount(winner, lot.moneda);

  return amount
    ? `${base}\nGanador: ${winnerName}\nMonto ganador: ${amount}`
    : `${base}\nGanador: ${winnerName}`;
};

export default function LotDetailScreen({ navigation, route }) {
  const { lotId, auctionId, guest } = route.params;
  const [lot, setLot] = useState(null);
  const [priceVisible, setPriceVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLot = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/lotes/${lotId}`, { auth: !guest });
      setLot(data.lot);
      setPriceVisible(Boolean(data.priceVisible && !guest));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [guest, lotId]);

  useEffect(() => {
    loadLot();
  }, [loadLot]);

  const isFinishedAuction = lot?.estadoSubasta === 'finalizada';
  const finishedLotMessage = isFinishedAuction ? buildFinishedLotMessage(lot) : '';

  const enterRoom = async () => {
    if (isFinishedAuction) {
      setError('Esta subasta ya finalizó.');
      return;
    }

    if (guest) {
      setError('Iniciá sesión para ingresar a la sala.');
      return;
    }

    try {
      await apiRequest(`/subastas/${auctionId}/ingresar`, { method: 'POST' });
      navigation.navigate('LiveAuction', { auctionId, guest: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Detalle de Lote</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ErrorBanner message={error} />
        <ErrorBanner message={finishedLotMessage} type="info" />

        {loading ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : lot ? (
          <>
            <View style={styles.imageSection}>
              {lot.imagenUrl ? (
                <Image source={{ uri: lot.imagenUrl }} style={styles.image} resizeMode="cover" />
              ) : (
                <View style={styles.image}>
                  <Text style={styles.imageText}>Imagen del lote</Text>
                </View>
              )}
              <Text style={styles.lotLabel}>LOTE #{lot.numeroPieza}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.title}>{lot.titulo}</Text>
              <Text style={styles.description}>{lot.descripcion}</Text>
              {lot.descripcionExtra ? <Text style={styles.meta}>{lot.descripcionExtra}</Text> : null}
              <View style={styles.divider} />
              <Text style={styles.price}>
                {priceVisible
                  ? `Base: ${lot.moneda || 'USD'} ${Number(lot.precioBase).toLocaleString('es-AR', { minimumFractionDigits: 0 })}`
                  : 'Iniciá sesión para ver el precio base'}
              </Text>
            </View>

            {(lot.artista || lot.fechaObjeto || lot.historia) && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Información Adicional</Text>
                {lot.artista ? (
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Artista</Text>
                    <Text style={styles.fieldValue}>{lot.artista}</Text>
                  </View>
                ) : null}
                {lot.fechaObjeto ? (
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Fecha</Text>
                    <Text style={styles.fieldValue}>{lot.fechaObjeto}</Text>
                  </View>
                ) : null}
                {lot.historia ? (
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Historia</Text>
                    <Text style={styles.fieldValue}>{lot.historia}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {isFinishedAuction ? null : (
              <AppButton onPress={enterRoom} title="Ir a subasta en vivo" />
            )}
          </>
        ) : null}
      </ScrollView>
      <BottomNav active="Auctions" guest={guest} navigation={navigation} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backArrow: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '700',
  },
  headerTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  imageSection: {
    gap: spacing.xs,
  },
  image: {
    alignItems: 'center',
    backgroundColor: '#D9EAFB',
    borderRadius: radius.md,
    height: 200,
    justifyContent: 'center',
    width: '100%',
  },
  imageText: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '900',
  },
  lotLabel: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '800',
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '900',
  },
  description: {
    color: colors.text,
    fontSize: typography.body,
  },
  meta: {
    color: colors.muted,
    fontSize: typography.body,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
  },
  price: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '800',
  },
  fieldRow: {
    gap: 2,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: '700',
  },
  fieldValue: {
    color: colors.text,
    fontSize: typography.body,
  },
});
