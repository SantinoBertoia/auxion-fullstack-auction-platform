import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import BottomNav from '../components/BottomNav';
import ErrorBanner from '../components/ErrorBanner';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing, typography } from '../constants/theme';
import { formatBidResult, formatCategory } from '../utils/formatters';

const TABS = [
  { key: 'Resumen', label: 'Resumen' },
  { key: 'Historial', label: 'Historial' },
  { key: 'Mensajes', label: 'Mensajes' },
];

export default function ActivityScreen({ navigation, route }) {
  const guest = Boolean(route.params?.guest);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(!guest);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('Resumen');

  const loadStats = useCallback(async () => {
    if (guest) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/usuarios/me/estadisticas');
      setStats(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [guest]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const messageCount = stats?.messages?.length || 0;
  const formatRegisteredAmount = (value) =>
    Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
  const formatHistoryDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backArrow}>{'<'}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Actividad</Text>
        </View>

        {guest ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Acceso restringido</Text>
            <Text style={styles.meta}>Iniciá sesión para ver métricas, historial, mensajes y alertas.</Text>
            <AppButton onPress={() => navigation.replace('Login')} title="Ir al login" />
          </View>
        ) : (
          <>
            <ErrorBanner message={error} />

            {loading ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : stats ? (
              <>
                <View style={styles.card}>
                  <View style={styles.profileRow}>
                    <View style={styles.profileAvatar}>
                      <Text style={styles.profileAvatarText}>
                        {(stats.user?.nombre || 'U').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.profileInfo}>
                      <Text style={styles.profileName}>{stats.user?.nombre || 'Usuario'}</Text>
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryBadgeText}>
                          {stats.user?.categoria ? formatCategory(stats.user.categoria) : 'Comprador'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.tabBar}>
                  {TABS.map((tab) => (
                    <Pressable
                      key={tab.key}
                      onPress={() => setActiveTab(tab.key)}
                      style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                    >
                      <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                        {tab.label}{tab.key === 'Mensajes' && messageCount > 0 ? ` ${messageCount}` : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {activeTab === 'Resumen' ? (
                  <>
                    <Text style={styles.sectionTitle}>Métricas Generales</Text>
                    <View style={styles.metricsGrid}>
                      <Metric label="Subastas asistidas" value={stats.metrics.subastasAsistidas} />
                      <Metric label="Subastas ganadas" value={stats.metrics.subastasGanadas} />
                      <Metric label="Monto ofertado registrado" value={formatRegisteredAmount(stats.metrics.montoOfertado)} />
                      <Metric label="Monto pagado registrado" value={formatRegisteredAmount(stats.metrics.montoPagado)} />
                    </View>
                  </>
                ) : null}

                {activeTab === 'Historial' ? (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Historial Reciente</Text>
                    {stats.history.length ? (
                      stats.history.map((item) => {
                        const result = item.resultado || '';
                        const isWon = result === 'ganada';
                        const isParticipating = result === 'participando';

                        return (
                          <View key={item.id} style={styles.historyRow}>
                            <View style={styles.historyLeft}>
                              <Text style={styles.historyName}>{item.lote}</Text>
                              <Text style={styles.historyMeta}>
                                {formatHistoryDate(item.createdAt)}{item.subasta ? ` · ${item.subasta}` : ''}
                              </Text>
                            </View>
                            <View style={styles.historyRight}>
                              <Text style={styles.historyAmount}>
                                {item.moneda} {Number(item.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                              </Text>
                              <View style={[
                                styles.statusBadge,
                                isWon ? styles.statusGanada : isParticipating ? styles.statusParticipando : styles.statusSuperada,
                              ]}>
                                <Text style={[
                                  styles.statusBadgeText,
                                  isWon ? styles.statusGanadaText : isParticipating ? styles.statusParticipandoText : styles.statusSuperadaText,
                                ]}>
                                  {formatBidResult(result)}
                                </Text>
                              </View>
                            </View>
                          </View>
                        );
                      })
                    ) : (
                      <Text style={styles.meta}>Todavía no hay actividad registrada.</Text>
                    )}
                  </View>
                ) : null}

                {activeTab === 'Mensajes' ? (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Mensajes y Alertas</Text>
                    {stats.messages.length ? (
                      stats.messages.map((msg) => (
                        <View key={msg.id} style={styles.messageRow}>
                          <Text style={styles.messageIcon}>{msg.tipo === 'alerta' ? '!' : 'i'}</Text>
                          <View style={styles.messageContent}>
                            <Text style={styles.messageTitle}>{msg.titulo}</Text>
                            <Text style={styles.meta}>{msg.cuerpo}</Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.meta}>No hay mensajes pendientes.</Text>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      <BottomNav active="Activity" guest={guest} navigation={navigation} />
    </SafeAreaView>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  backButton: { paddingRight: spacing.sm, paddingVertical: spacing.xs },
  backArrow: { color: colors.primary, fontSize: typography.subtitle, fontWeight: '700' },
  headerTitle: { color: colors.text, flex: 1, fontSize: typography.subtitle, fontWeight: '900' },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: { color: colors.primary, fontSize: typography.subtitle, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: typography.body },
  profileRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  profileAvatarText: { color: colors.white, fontSize: typography.subtitle, fontWeight: '900' },
  profileInfo: { flex: 1, gap: 4 },
  profileName: { color: colors.text, fontSize: typography.body, fontWeight: '800' },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E0F2FE',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  categoryBadgeText: { color: colors.primary, fontSize: typography.small, fontWeight: '700' },
  tabBar: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  tab: { alignItems: 'center', flex: 1, paddingVertical: spacing.sm },
  tabActive: { borderBottomColor: colors.primary, borderBottomWidth: 2 },
  tabText: { color: colors.muted, fontSize: typography.body, fontWeight: '700' },
  tabTextActive: { color: colors.primary },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metric: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: '47%',
    gap: 4,
    minHeight: 90,
    padding: spacing.md,
  },
  metricValue: { color: colors.primary, fontSize: typography.subtitle, fontWeight: '900' },
  metricLabel: { color: colors.muted, fontSize: typography.small },
  historyRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  historyLeft: { flex: 1, gap: 2 },
  historyName: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  historyMeta: { color: colors.muted, fontSize: typography.small },
  historyRight: { alignItems: 'flex-end', gap: 4 },
  historyAmount: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusGanada: { backgroundColor: '#ECFDF3' },
  statusSuperada: { backgroundColor: '#FEF3F2' },
  statusParticipando: { backgroundColor: '#E0F2FE' },
  statusBadgeText: { fontSize: typography.small, fontWeight: '700' },
  statusGanadaText: { color: colors.success },
  statusSuperadaText: { color: colors.danger },
  statusParticipandoText: { color: colors.primary },
  messageRow: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm },
  messageIcon: { fontSize: 20, marginTop: 2 },
  messageContent: { flex: 1, gap: 4 },
  messageTitle: { color: colors.text, fontSize: typography.body, fontWeight: '800' },
});
