import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import BottomNav from '../components/BottomNav';
import ErrorBanner from '../components/ErrorBanner';
import LotCard from '../components/LotCard';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing, typography } from '../constants/theme';
import { formatCategory } from '../utils/formatters';

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

const buildFinishedAuctionMessage = (auction) => {
  const base = 'Esta subasta ya finalizó. No se pueden realizar más pujas.';
  const winner = auction?.winner || auction?.ganador;

  if (!winner) {
    return `${base}\nFinalizó sin pujas registradas.`;
  }

  const winnerName = winner.postor || winner.email || 'usuario ganador';
  const amount = formatWinnerAmount(winner, auction.moneda);
  const lot =
    winner.lote?.titulo ||
    (typeof winner.lote === 'string' ? winner.lote : null) ||
    winner.articulo ||
    null;
  const details = [`Ganador: ${winnerName}`];

  if (amount) {
    details.push(`Monto ganador: ${amount}`);
  }
  if (lot) {
    details.push(`Lote: ${lot}`);
  }

  return `${base}\n${details.join('\n')}`;
};

export default function AuctionDetailScreen({ navigation, route }) {
  const { auctionId, guest } = route.params;
  const [auction, setAuction] = useState(null);
  const [lots, setLots] = useState([]);
  const [priceVisible, setPriceVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState('');

  const loadAuction = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/subastas/${auctionId}`, { auth: !guest });
      setAuction(data.auction);
      setLots(data.lots || []);
      setPriceVisible(Boolean(data.priceVisible && !guest));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [auctionId, guest]);

  useEffect(() => {
    loadAuction();
  }, [loadAuction]);

  const enterRoom = async () => {
    if (guest) {
      setError('Iniciá sesión para ingresar a la sala.');
      return;
    }

    setEntering(true);
    setError('');
    try {
      await apiRequest(`/subastas/${auctionId}/ingresar`, { method: 'POST' });
      navigation.navigate('LiveAuction', { auctionId, guest: false });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setEntering(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Detalle de Subasta</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ErrorBanner message={error} />
        <ErrorBanner
          message={auction?.estado === 'finalizada' ? buildFinishedAuctionMessage(auction) : ''}
          type="info"
        />

        {loading ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : auction ? (
          <>
            <View style={styles.hero}>
              {auction.imagenUrl ? (
                <Image source={{ uri: auction.imagenUrl }} style={styles.heroImage} resizeMode="cover" />
              ) : (
                <View style={styles.heroImage}>
                  <Text style={styles.heroText}>Auxion</Text>
                </View>
              )}
              <View style={styles.heroContent}>
                <Text style={styles.title}>{auction.titulo}</Text>
                <View style={styles.infoRow}>
                  <Text style={styles.infoIcon}>📅</Text>
                  <Text style={styles.infoText}>{auction.fecha} - {auction.hora}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoIcon}>🏷️</Text>
                  <Text style={styles.infoText}>{formatCategory(auction.categoria)} · {auction.moneda}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoIcon}>📍</Text>
                  <Text style={styles.infoText}>{auction.ubicacion}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoIcon}>👤</Text>
                  <Text style={styles.infoText}>{auction.rematador}</Text>
                </View>
                {auction.estado === 'abierta' && (
                  <AppButton
                    disabled={entering}
                    onPress={enterRoom}
                    title={entering ? 'Ingresando...' : 'Ingresar a subasta en vivo'}
                  />
                )}
              </View>
            </View>

            <Text style={styles.sectionTitle}>Catálogo de lotes</Text>
            {lots.map((lot) => (
              <LotCard
                key={lot.id}
                lot={lot}
                moneda={auction.moneda}
                onPress={() => navigation.navigate('LotDetail', { lotId: lot.id, auctionId, guest })}
                priceVisible={priceVisible}
              />
            ))}
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
  hero: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heroImage: {
    alignItems: 'center',
    backgroundColor: '#D9EAFB',
    height: 180,
    justifyContent: 'center',
    width: '100%',
  },
  heroText: {
    color: colors.primary,
    fontSize: 30,
    fontWeight: '900',
  },
  heroContent: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '900',
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  infoIcon: {
    fontSize: 16,
  },
  infoText: {
    color: colors.text,
    fontSize: typography.body,
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
});
