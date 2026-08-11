import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import ErrorBanner from '../components/ErrorBanner';
import StatusBadge from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing, typography } from '../constants/theme';
import { formatArticleStatus } from '../utils/formatters';

const getArticlePhoto = (article, documentation) => {
  if (Array.isArray(documentation?.fotos) && documentation.fotos.length > 0) return documentation.fotos[0];
  if (Array.isArray(article?.fotos) && article.fotos.length > 0) return article.fotos[0];
  return article?.imagenFrente || article?.imagenDorso || null;
};

const getArticleDisplayStatus = (article, documentation, tracking) => {
  if (documentation?.acepta_condiciones === true || article?.aceptaCondiciones === true) {
    return 'condiciones_aceptadas';
  }
  if (documentation?.acepta_condiciones === false || article?.aceptaCondiciones === false) {
    return 'condiciones_rechazadas';
  }
  if ((tracking || []).some((entry) => entry.estado === 'aceptado')) {
    return 'condiciones_propuestas';
  }
  return article?.estado;
};

export default function ItemTrackingScreen({ navigation, route }) {
  const { articleId, message: initialMessage } = route.params;
  const [article, setArticle] = useState(null);
  const [tracking, setTracking] = useState([]);
  const [details, setDetails] = useState({});
  const [documentation, setDocumentation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState(initialMessage || '');
  const [saving, setSaving] = useState(false);

  const loadTracking = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/articulos/${articleId}/seguimiento`);
      setArticle(data.article);
      setTracking(data.tracking || []);
      setDocumentation(data.documentacion || null);
      setDetails({
        valorBase: data.valor_base,
        comision: data.comision,
        ubicacionDeposito: data.ubicacion_deposito,
        polizaSeguro: data.poliza_seguro,
        subastaAsignada: data.subasta_asignada,
        motivoRechazo: data.motivo_rechazo,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    loadTracking();
  }, [loadTracking]);

  const respondCondiciones = async (acepta) => {
    setSaving(true);
    setError('');
    setActionMessage('');
    try {
      const response = await apiRequest(`/articulos/${articleId}/condiciones`, {
        method: 'PATCH',
        body: { acepta },
      });
      await loadTracking();
      setActionMessage(response.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const dotStyle = (entry, index) => {
    const isLast = index === tracking.length - 1;
    if (isLast) return [styles.dot, styles.dotActive];
    return [styles.dot, styles.dotCompleted];
  };

  const formatAmount = (value) => {
    if (value === undefined || value === null || value === '') return null;
    return Number(value).toLocaleString('es-AR', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });
  };

  const renderDetailLine = (label, value) => {
    if (value === undefined || value === null || value === '') return null;
    return <Text style={styles.detailValue}>{label}: {value}</Text>;
  };

  const conditionDecision = documentation?.acepta_condiciones;
  const conditionDecisionMade = conditionDecision === true || conditionDecision === false;
  const hasConditionDetails = Boolean(
    article?.condicionesVenta ||
      (details.valorBase !== undefined && details.valorBase !== null) ||
      (details.comision !== undefined && details.comision !== null)
  );
  const photoCount = documentation?.fotos?.length || article?.fotos?.length || 0;
  const photoUri = getArticlePhoto(article, documentation);
  const displayStatus = getArticleDisplayStatus(article, documentation, tracking);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Seguimiento de artículo</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ErrorBanner message={error} />
        <ErrorBanner message={actionMessage} type="info" />

        {loading ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : article ? (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryThumb}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.summaryImage} />
                ) : (
                  <Text style={styles.thumbIcon}>IMG</Text>
                )}
              </View>
              <View style={styles.summaryInfo}>
                <Text style={styles.summaryTitle}>{article.titulo}</Text>
                <StatusBadge label={displayStatus} />
              </View>
            </View>

            {tracking.length > 0 && (
              <View style={styles.timelineContainer}>
                {tracking.map((entry, index) => (
                  <View key={entry.id || index} style={styles.timelineEntry}>
                    <View style={styles.timelineLeft}>
                      <View style={dotStyle(entry, index)} />
                      {index < tracking.length - 1 && <View style={styles.line} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineEstado}>
                        {formatArticleStatus(entry.estado)}
                      </Text>
                      <Text style={styles.timelineDate}>{formatDate(entry.createdAt)}</Text>
                      {entry.descripcion ? (
                        <Text style={styles.timelineDesc}>{entry.descripcion}</Text>
                      ) : null}

                      {entry.estado === 'aceptado' && hasConditionDetails && (
                        <View style={styles.detailCard}>
                          <Text style={styles.detailLabel}>Condiciones de venta</Text>
                          {article.condicionesVenta ? (
                            <Text style={styles.detailValue}>{article.condicionesVenta}</Text>
                          ) : null}
                          {renderDetailLine('Valor base', formatAmount(details.valorBase))}
                          {renderDetailLine('Comision', formatAmount(details.comision))}
                          {renderDetailLine('Deposito', details.ubicacionDeposito)}
                          {renderDetailLine('Poliza', details.polizaSeguro)}
                          {renderDetailLine('Subasta asignada', details.subastaAsignada)}
                          {photoCount > 0 ? renderDetailLine('Fotos cargadas', photoCount) : null}
                          {conditionDecisionMade ? (
                            <Text style={styles.decisionText}>
                              {conditionDecision
                                ? 'Condiciones aceptadas por el usuario.'
                                : 'Condiciones rechazadas. Se procedera a devolucion con cargo.'}
                            </Text>
                          ) : (
                            <>
                              <AppButton
                                disabled={saving}
                                onPress={() => respondCondiciones(true)}
                                title={saving ? 'Guardando...' : 'Aceptar condiciones'}
                              />
                              <AppButton
                                disabled={saving}
                                onPress={() => respondCondiciones(false)}
                                title="No aceptar tasacion"
                                variant="secondary"
                              />
                            </>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
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
    backgroundColor: colors.white,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
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
  summaryCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  summaryThumb: {
    alignItems: 'center',
    backgroundColor: '#F2F4F7',
    borderRadius: radius.sm,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 56,
  },
  summaryImage: {
    height: '100%',
    width: '100%',
  },
  thumbIcon: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  summaryInfo: {
    flex: 1,
    gap: 4,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  timelineContainer: {
    paddingLeft: spacing.xs,
  },
  timelineEntry: {
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 80,
  },
  timelineLeft: {
    alignItems: 'center',
    width: 24,
  },
  dot: {
    borderRadius: 12,
    height: 24,
    marginTop: 2,
    width: 24,
  },
  dotCompleted: {
    backgroundColor: colors.primary,
  },
  dotActive: {
    backgroundColor: colors.primary,
    borderColor: colors.white,
    borderWidth: 4,
  },
  line: {
    backgroundColor: colors.border,
    flex: 1,
    marginTop: 4,
    width: 2,
  },
  timelineContent: {
    flex: 1,
    gap: 4,
    paddingBottom: spacing.lg,
  },
  timelineEstado: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  timelineDate: {
    color: colors.muted,
    fontSize: typography.small,
  },
  timelineDesc: {
    color: colors.text,
    fontSize: typography.small,
    marginTop: 4,
  },
  detailCard: {
    backgroundColor: '#F9FAFB',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: '700',
  },
  detailValue: {
    color: colors.text,
    fontSize: typography.body,
  },
  decisionText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
});
