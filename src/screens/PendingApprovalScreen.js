import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import ErrorBanner from '../components/ErrorBanner';
import { apiRequest } from '../services/apiClient';
import { clearSession } from '../storage/authStorage';
import { colors, radius, spacing, typography } from '../constants/theme';

export default function PendingApprovalScreen({ navigation, route }) {
  const initialPreRegistration = route.params?.preRegistro || null;
  const email = route.params?.email || initialPreRegistration?.email || '';
  const [preRegistro, setPreRegistro] = useState(initialPreRegistration);
  const [message, setMessage] = useState(route.params?.message || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const estado = preRegistro?.estado || 'pendiente';
  const isApproved = estado === 'aprobado';
  const isRejected = estado === 'rechazado';
  const isCompleted = estado === 'completado';

  const reviewDate = preRegistro?.verificacionDisponibleEn
    ? new Date(preRegistro.verificacionDisponibleEn).toLocaleString()
    : null;

  const handleCheckStatus = async () => {
    if (!email) {
      setError('No hay email de solicitud para consultar.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/usuarios/pre-registro/estado?email=${encodeURIComponent(email)}`, {
        auth: false,
      });
      setPreRegistro(data.preRegistro);
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    navigation.replace('Register', {
      mode: 'complete',
    });
  };

  const handleLogout = async () => {
    await clearSession();
    navigation.replace('Login');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconBox}>
          <Text style={styles.icon}>{isApproved ? 'OK' : isRejected ? '!' : '...'}</Text>
        </View>

        <Text style={styles.title}>
          {isApproved ? 'Solicitud aprobada' : isRejected ? 'Solicitud no aprobada' : 'Cuenta en revision'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.body}>
            {message || 'Tu solicitud de registro fue recibida y esta siendo evaluada por nuestro equipo.'}
          </Text>
          {email ? <Text style={styles.body}>Email de contacto: {email}</Text> : null}
          {reviewDate && !isApproved ? (
            <Text style={styles.body}>Revision disponible desde: {reviewDate}</Text>
          ) : null}
          {isApproved ? (
            <Text style={styles.body}>
              Ya podes completar el registro, generar tu clave personal y cargar un medio de pago.
            </Text>
          ) : null}
          {isCompleted ? <Text style={styles.body}>El registro ya fue completado. Inicia sesion.</Text> : null}
        </View>

        <ErrorBanner message={error} />
        {loading ? <ActivityIndicator color={colors.primary} /> : null}

        {isApproved ? <AppButton onPress={handleComplete} title="Completar registro" /> : null}
        {!isRejected && !isCompleted ? (
          <AppButton disabled={loading} onPress={handleCheckStatus} title="Consultar estado" variant="secondary" />
        ) : null}
        <AppButton onPress={handleLogout} title="Volver al inicio" variant="secondary" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  container: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xl,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 50,
    height: 100,
    justifyContent: 'center',
    width: 100,
  },
  icon: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: '900',
  },
  title: {
    color: colors.primary,
    fontSize: typography.title,
    fontWeight: '900',
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  body: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 22,
    textAlign: 'center',
  },
});
