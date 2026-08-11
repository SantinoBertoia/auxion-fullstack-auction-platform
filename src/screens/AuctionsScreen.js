import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import AppButton from '../components/AppButton';
import AuctionCard from '../components/AuctionCard';
import BottomNav from '../components/BottomNav';
import ErrorBanner from '../components/ErrorBanner';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useConnectivity } from '../hooks/useConnectivity';

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

const getWinnerLotTitle = (winner) =>
  winner?.lote?.titulo ||
  (typeof winner?.lote === 'string' ? winner.lote : null) ||
  winner?.articulo ||
  null;

const getFinishedAuctionSummary = (auction) => {
  const winners = Array.isArray(auction.winners)
    ? auction.winners.filter(Boolean)
    : [];
  const fallbackWinner = auction.winner || auction.ganador;
  const results = winners.length ? winners : fallbackWinner ? [fallbackWinner] : [];

  if (!results.length) {
    return {
      hasWinner: false,
      message: 'Finalizó sin pujas registradas.',
    };
  }

  const bestWinner = results.reduce((best, current) => {
    const bestAmount = Number(best?.monto || 0);
    const currentAmount = Number(current?.monto || 0);
    return currentAmount > bestAmount ? current : best;
  }, results[0]);

  return {
    hasWinner: true,
    isMultiple: results.length > 1,
    soldLots: results.length,
    winnerName: bestWinner.postor || bestWinner.email || 'usuario ganador',
    amount: formatWinnerAmount(bestWinner, auction.moneda),
    lot: getWinnerLotTitle(bestWinner),
  };
};

export default function AuctionsScreen({ navigation, route }) {
  const guest = Boolean(route.params?.guest);
  const { isConnected } = useConnectivity();
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [finishedModalAuction, setFinishedModalAuction] = useState(null);

  const loadAuctions = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const data = await apiRequest('/subastas', { auth: false });
      setAuctions(data.auctions || []);
    } catch (requestError) {
      // Silenciamos el error de conexion: si falla un refresco, mantenemos las
      // subastas ya cargadas en vez de mostrar "No se pudo conectar al backend".
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAuctions();

      const intervalId = setInterval(() => {
        loadAuctions({ showLoading: false });
      }, 30000);

      return () => clearInterval(intervalId);
    }, [loadAuctions])
  );

  const abiertas = auctions.filter((a) => a.estado === 'abierta');
  const proximas = auctions.filter((a) => a.estado === 'proxima');
  const finalizadas = auctions.filter((a) => a.estado === 'finalizada');

  const handleAuctionPress = (auction) => {
    if (auction.estado === 'finalizada') {
      setFinishedModalAuction(auction);
      return;
    }

    setFinishedModalAuction(null);
    navigation.navigate('AuctionDetail', { auctionId: auction.id, guest });
  };

  const finishedSummary = finishedModalAuction
    ? getFinishedAuctionSummary(finishedModalAuction)
    : null;

  const renderSection = (title, items) => {
    if (!items.length) return null;
    return (
      <View key={title} style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {items.map((item) => (
          <AuctionCard
            key={item.id}
            auction={item}
            onPress={() => handleAuctionPress(item)}
          />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Subastas</Text>
      </View>

      <View style={styles.content}>
        {!isConnected ? <ErrorBanner message="Sin conexión. Se necesita internet para actualizar subastas." /> : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : auctions.length === 0 ? (
          <Text style={styles.empty}>No hay subastas disponibles.</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {renderSection('Subastas abiertas', abiertas)}
            {renderSection('Próximas subastas', proximas)}
            {renderSection('Finalizadas', finalizadas)}
          </ScrollView>
        )}
      </View>

      <BottomNav active="Auctions" guest={guest} navigation={navigation} />

      <Modal
        animationType="fade"
        onRequestClose={() => setFinishedModalAuction(null)}
        transparent
        visible={Boolean(finishedModalAuction)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Subasta finalizada</Text>
            <Text style={styles.modalText}>
              Esta subasta ya finalizó y no admite nuevas pujas.
            </Text>
            {finishedSummary?.hasWinner ? (
              <View style={styles.summaryBox}>
                {finishedSummary.isMultiple ? (
                  <>
                    <Text style={styles.summaryLabel}>Lotes vendidos</Text>
                    <Text style={styles.summaryValue}>{finishedSummary.soldLots}</Text>
                  </>
                ) : null}
                {finishedSummary.amount ? (
                  <>
                    <Text style={styles.summaryLabel}>
                      {finishedSummary.isMultiple ? 'Mejor venta' : 'Monto'}
                    </Text>
                    <Text style={styles.summaryValue}>{finishedSummary.amount}</Text>
                  </>
                ) : null}
                <Text style={styles.summaryLabel}>Ganador</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>
                  {finishedSummary.winnerName}
                </Text>
                {finishedSummary.lot ? (
                  <>
                    <Text style={styles.summaryLabel}>Lote</Text>
                    <Text style={styles.summaryValue} numberOfLines={2}>
                      {finishedSummary.lot}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : (
              <Text style={styles.modalMeta}>{finishedSummary?.message}</Text>
            )}
            <AppButton
              onPress={() => setFinishedModalAuction(null)}
              title="Entendido"
            />
          </View>
        </View>
      </Modal>
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
    paddingVertical: spacing.md,
  },
  backArrow: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  headerTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  section: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    gap: spacing.sm,
    maxWidth: 380,
    padding: spacing.lg,
    width: '100%',
  },
  modalTitle: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalText: {
    color: colors.text,
    fontSize: typography.body,
    textAlign: 'center',
  },
  modalMeta: {
    color: colors.muted,
    fontSize: typography.body,
    textAlign: 'center',
  },
  summaryBox: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 2,
    padding: spacing.md,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: '700',
  },
  summaryValue: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
});
