import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import AppTextInput from '../components/AppTextInput';
import BottomNav from '../components/BottomNav';
import ErrorBanner from '../components/ErrorBanner';
import StatusBadge from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { clearSession } from '../storage/authStorage';
import { colors, spacing, typography, radius } from '../constants/theme';
import { formatPaymentType } from '../utils/formatters';
import {
  PAYMENT_CURRENCIES,
  PAYMENT_TYPES,
  buildPaymentPayload,
  validatePaymentPayload,
} from '../utils/paymentValidation';

const getPaymentStatus = (payment) => {
  if (Number(payment.verificado) === 1) return 'Verificado';
  if (Number(payment.verificado) === -1) return 'Rechazado';
  return 'Pendiente';
};

export default function AccountScreen({ navigation, route }) {
  const guest = Boolean(route.params?.guest);
  const [profile, setProfile] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(!guest);
  const [error, setError] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [cobroModalVisible, setCobroModalVisible] = useState(false);
  const [newPayment, setNewPayment] = useState({
    tipo: 'tarjeta',
    moneda: 'USD',
    alias: '',
    banco: '',
    numero: '',
    montoGarantia: '',
  });
  const [cuentaCobro, setCuentaCobro] = useState({ banco: '', cbu: '', alias: '' });

  const loadAccount = useCallback(async () => {
    if (guest) return;
    setLoading(true);
    setError('');
    try {
      const [profileData, paymentData] = await Promise.all([
        apiRequest('/usuarios/me/perfil'),
        apiRequest('/usuarios/me/pagos'),
      ]);
      setProfile(profileData.profile);
      setPayments(paymentData.payments || []);
      if (profileData.profile.cuentaCobro) {
        setCuentaCobro({
          banco: profileData.profile.cuentaCobro.banco || '',
          cbu: profileData.profile.cuentaCobro.cbu || '',
          alias: profileData.profile.cuentaCobro.alias || '',
        });
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [guest]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const updateNewPayment = (field, value) => {
    setNewPayment((current) => ({ ...current, [field]: value }));
  };

  const getPaymentNumberLabel = () => {
    if (newPayment.tipo === 'tarjeta') return 'Numero de tarjeta';
    if (newPayment.tipo === 'cuenta_bancaria') return 'CBU, CVU, IBAN o cuenta';
    return 'Numero de cheque';
  };

  const addPayment = async () => {
    const validationError = validatePaymentPayload(newPayment);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      const response = await apiRequest('/usuarios/me/pagos', {
        method: 'POST',
        body: buildPaymentPayload(newPayment),
      });
      setModalVisible(false);
      setNewPayment({ tipo: 'tarjeta', moneda: 'USD', alias: '', banco: '', numero: '', montoGarantia: '' });
      await loadAccount();
      Alert.alert('Medio registrado', response.message);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const saveCuentaCobro = async () => {
    if (!cuentaCobro.banco || !cuentaCobro.cbu || !cuentaCobro.alias) {
      setError('Banco, CBU y alias son obligatorios.');
      return;
    }
    try {
      await apiRequest('/usuarios/me/cuenta-cobro', {
        method: 'PATCH',
        body: cuentaCobro,
      });
      setCobroModalVisible(false);
      await loadAccount();
      Alert.alert('Cuenta actualizada', 'Cuenta de cobro actualizada correctamente.');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const logout = async () => {
    await clearSession();
    navigation.replace('Login');
  };

  const paymentIcon = (tipo) => {
    if (tipo === 'tarjeta') return '💳';
    if (tipo === 'cuenta_bancaria') return '🏦';
    return '📄';
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Mi Cuenta</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {guest ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Invitado</Text>
            <Text style={styles.meta}>Iniciá sesión para ver perfil, categoría, admisión y medios de pago.</Text>
            <AppButton onPress={() => navigation.replace('Login')} title="Ir al login" />
          </View>
        ) : (
          <>
            <ErrorBanner message={error} />
            {loading ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : profile ? (
              <>
                <Text style={styles.sectionHeader}>Datos de cuenta</Text>
                <Text style={styles.sectionSub}>Información principal para terminar de quedar habilitado</Text>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.cardLabel}>Categoría asignada</Text>
                    <StatusBadge label={profile.categoria} />
                  </View>
                  <View style={styles.divider} />
                  <Text style={styles.cardLabel}>Estado de admisión</Text>
                  <StatusBadge label={profile.estadoAdmision} />
                  <View style={styles.divider} />
                  <Text style={styles.meta}>{profile.nombre} {profile.apellido}</Text>
                  <Text style={styles.meta}>{profile.email}</Text>
                  {profile.domicilio ? <Text style={styles.meta}>{profile.domicilio}</Text> : null}
                </View>

                <Text style={styles.sectionHeader}>Medios de pago</Text>
                <Text style={styles.sectionSub}>Para pujar hace falta al menos un medio verificado.</Text>

                {payments.map((payment) => (
                  <View key={payment.id} style={styles.paymentCard}>
                    <View style={styles.paymentRow}>
                      <Text style={styles.paymentIcon}>{paymentIcon(payment.tipo)}</Text>
                      <View style={styles.paymentInfo}>
                        <Text style={styles.paymentTitle}>
                          {payment.alias} · {formatPaymentType(payment.tipo)} ({payment.moneda})
                        </Text>
                        <StatusBadge label={getPaymentStatus(payment)} />
                      </View>
                    </View>
                  </View>
                ))}

                <AppButton
                  onPress={() => setModalVisible(true)}
                  title="+ Agregar medio de pago"
                  variant="link"
                />

                <Text style={styles.sectionHeader}>Cuenta de cobro</Text>
                <Text style={styles.sectionSub}>Donde se enviará el dinero por artículos vendidos o comprados por la empresa.</Text>

                <View style={styles.card}>
                  {cuentaCobro.banco ? (
                    <>
                      <View style={styles.infoRow}>
                        <Text style={styles.paymentIcon}>🏦</Text>
                        <View>
                          <Text style={styles.paymentTitle}>{cuentaCobro.banco}</Text>
                          <Text style={styles.meta}>CBU: {cuentaCobro.cbu}</Text>
                          <Text style={styles.meta}>Alias: {cuentaCobro.alias}</Text>
                        </View>
                      </View>
                      <AppButton
                        onPress={() => setCobroModalVisible(true)}
                        title="Modificar cuenta declarada"
                        variant="link"
                      />
                    </>
                  ) : (
                    <AppButton
                      onPress={() => setCobroModalVisible(true)}
                      title="Agregar cuenta de cobro"
                      variant="secondary"
                    />
                  )}
                </View>

                <AppButton onPress={logout} title="Cerrar sesión" variant="secondary" />
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      <BottomNav active="Account" guest={guest} navigation={navigation} />

      <Modal animationType="slide" onRequestClose={() => setModalVisible(false)} transparent visible={modalVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.sectionTitle}>Nuevo medio de pago</Text>
            <View style={styles.row}>
              {PAYMENT_TYPES.map((type) => (
                <AppButton
                  key={type}
                  onPress={() => updateNewPayment('tipo', type)}
                  title={formatPaymentType(type)}
                  variant={newPayment.tipo === type ? 'primary' : 'secondary'}
                  style={styles.smallButton}
                />
              ))}
            </View>
            <View style={styles.row}>
              {PAYMENT_CURRENCIES.map((currency) => (
                <AppButton
                  key={currency}
                  onPress={() => updateNewPayment('moneda', currency)}
                  title={currency}
                  variant={newPayment.moneda === currency ? 'primary' : 'secondary'}
                  style={styles.smallButton}
                />
              ))}
            </View>
            <AppTextInput label="Alias" onChangeText={(value) => updateNewPayment('alias', value)} value={newPayment.alias} />
            <AppTextInput label="Banco" onChangeText={(value) => updateNewPayment('banco', value)} value={newPayment.banco} />
            <AppTextInput
              keyboardType={newPayment.tipo === 'tarjeta' ? 'numeric' : 'default'}
              label={getPaymentNumberLabel()}
              onChangeText={(value) => updateNewPayment('numero', value)}
              value={newPayment.numero}
            />
            <AppTextInput
              keyboardType="numeric"
              label="Monto de garantia"
              onChangeText={(value) => updateNewPayment('montoGarantia', value)}
              value={newPayment.montoGarantia}
            />
            <AppButton onPress={addPayment} title="Guardar medio de pago" />
            <AppButton onPress={() => setModalVisible(false)} title="Cancelar" variant="link" />
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setCobroModalVisible(false)} transparent visible={cobroModalVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.sectionTitle}>Cuenta de cobro</Text>
            <AppTextInput
              label="Banco"
              onChangeText={(value) => setCuentaCobro((c) => ({ ...c, banco: value }))}
              value={cuentaCobro.banco}
            />
            <AppTextInput
              label="CBU"
              onChangeText={(value) => setCuentaCobro((c) => ({ ...c, cbu: value }))}
              value={cuentaCobro.cbu}
            />
            <AppTextInput
              label="Alias"
              onChangeText={(value) => setCuentaCobro((c) => ({ ...c, alias: value }))}
              value={cuentaCobro.alias}
            />
            <AppButton onPress={saveCuentaCobro} title="Guardar cambios" />
            <AppButton onPress={() => setCobroModalVisible(false)} title="Cancelar" variant="link" />
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
    gap: spacing.sm,
    padding: spacing.lg,
  },
  sectionHeader: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '900',
    marginTop: spacing.md,
  },
  sectionSub: {
    color: colors.muted,
    fontSize: typography.small,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardLabel: {
    color: colors.text,
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
  },
  meta: {
    color: colors.muted,
    fontSize: typography.body,
  },
  paymentCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  paymentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  paymentIcon: {
    fontSize: 24,
  },
  paymentInfo: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paymentTitle: {
    color: colors.text,
    flex: 1,
    fontWeight: '800',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    gap: spacing.md,
    maxHeight: '90%',
    padding: spacing.lg,
  },
  smallButton: {
    flexGrow: 1,
  },
});
