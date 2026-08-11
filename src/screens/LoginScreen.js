import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import AppTextInput from '../components/AppTextInput';
import ErrorBanner from '../components/ErrorBanner';
import { apiRequest } from '../services/apiClient';
import { clearSession, saveSession } from '../storage/authStorage';
import { colors, spacing, typography } from '../constants/theme';
import { useConnectivity } from '../hooks/useConnectivity';

export default function LoginScreen({ navigation }) {
  const { isConnected } = useConnectivity();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const validateEmail = (value) => {
    if (!value.trim()) return 'Email es obligatorio';
    if (!/^\S+@\S+\.\S+$/.test(value.trim())) return 'Ingresa un email valido';
    return '';
  };

  const validate = () => {
    if (!email.trim() || !password.trim()) return 'Email y contrasena son obligatorios';
    const emailError = validateEmail(email);
    if (emailError) return emailError;
    return '';
  };

  const handleLogin = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!isConnected) {
      setError('Sin conexion. Revisa tu internet e intenta nuevamente.');
      return;
    }

    setLoading(true);
    setError('');
    setResetMessage('');

    try {
      const data = await apiRequest('/usuarios/login', {
        method: 'POST',
        auth: false,
        body: { email: email.trim(), password },
      });
      await saveSession(data);
      if (data.user?.estadoAdmision === 'en_revision') {
        navigation.replace('PendingApproval', { email: email.trim() });
        return;
      }
      navigation.replace('Auctions', { guest: false });
    } catch (requestError) {
      const code = requestError.data?.code;
      if (code === 'REGISTRATION_PENDING') {
        navigation.replace('PendingApproval', {
          email: email.trim(),
          preRegistro: requestError.data?.preRegistro,
          message: requestError.message,
        });
        return;
      }
      if (code === 'REGISTRATION_INCOMPLETE') {
        navigation.navigate('Register', {
          mode: 'complete',
        });
        return;
      }
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const startPasswordReset = () => {
    setAuthMode('requestReset');
    setResetEmail(email.trim());
    setResetToken('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResetMessage('');
    setError('');
  };

  const backToLogin = () => {
    setAuthMode('login');
    setError('');
  };

  const handleSendPasswordReset = async () => {
    const emailError = validateEmail(resetEmail);
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!isConnected) {
      setError('Sin conexion. Revisa tu internet e intenta nuevamente.');
      return;
    }

    setResetLoading(true);
    setError('');
    setResetMessage('');

    try {
      const data = await apiRequest('/usuarios/recuperar-password', {
        method: 'POST',
        auth: false,
        body: { email: resetEmail.trim() },
      });
      setResetMessage(data.message);
      setAuthMode('confirmReset');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const emailError = validateEmail(resetEmail);
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!resetToken.trim()) {
      setError('El codigo de recuperacion es obligatorio');
      return;
    }
    if (!resetPassword.trim()) {
      setError('La nueva contrasena es obligatoria');
      return;
    }
    if (resetPassword.length < 6) {
      setError('La contrasena debe tener al menos 6 caracteres');
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      setError('Las contrasenas no coinciden');
      return;
    }
    if (!isConnected) {
      setError('Sin conexion. Revisa tu internet e intenta nuevamente.');
      return;
    }

    setResetLoading(true);
    setError('');

    try {
      const data = await apiRequest('/usuarios/restablecer-password', {
        method: 'POST',
        auth: false,
        body: {
          email: resetEmail.trim(),
          token: resetToken.trim(),
          password: resetPassword,
          confirmPassword: resetConfirmPassword,
        },
      });
      setEmail(resetEmail.trim());
      setPassword('');
      setResetToken('');
      setResetPassword('');
      setResetConfirmPassword('');
      setResetMessage(data.message);
      setAuthMode('login');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleGuest = async () => {
    await clearSession();
    navigation.replace('Auctions', { guest: true });
  };

  const renderLogin = () => (
    <>
      <AppTextInput
        autoCapitalize="none"
        keyboardType="email-address"
        label="Email"
        onChangeText={setEmail}
            placeholder="nombre@email.com"
        value={email}
      />
      <View style={styles.passwordRow}>
        <View style={{ flex: 1 }}>
          <AppTextInput
            label="Contrasena"
            onChangeText={setPassword}
            placeholder="Ingresa tu contrasena"
            secureTextEntry={!showPassword}
            value={password}
          />
        </View>
        <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
          <Text style={styles.toggleText}>{showPassword ? 'Ocultar' : 'Ver'}</Text>
        </Pressable>
      </View>

      <AppButton disabled={loading} onPress={handleLogin} title={loading ? 'Ingresando...' : 'Iniciar sesion'} />
      <AppButton onPress={() => navigation.navigate('Register')} title="Registrarme" variant="secondary" />
      <AppButton onPress={handleGuest} title="Entrar como invitado" variant="secondary" />
      <AppButton onPress={startPasswordReset} title="Olvide mi contrasena" variant="link" />
      <AppButton onPress={() => navigation.navigate('Register', { mode: 'complete' })} title="Completar registro" variant="link" />
    </>
  );

  const renderRequestReset = () => (
    <>
      <Text style={styles.title}>Recuperar contrasena</Text>
      <AppTextInput
        autoCapitalize="none"
        keyboardType="email-address"
        label="Email"
        onChangeText={setResetEmail}
        placeholder="nombre@email.com"
        value={resetEmail}
      />
      <AppButton
        disabled={resetLoading}
        onPress={handleSendPasswordReset}
        title={resetLoading ? 'Enviando...' : 'Enviar codigo'}
      />
      <AppButton onPress={backToLogin} title="Volver al login" variant="link" />
    </>
  );

  const renderConfirmReset = () => (
    <>
      <Text style={styles.title}>Nueva contrasena</Text>
      <AppTextInput
        autoCapitalize="none"
        keyboardType="email-address"
        label="Email"
        onChangeText={setResetEmail}
        value={resetEmail}
      />
      <AppTextInput
        autoCapitalize="characters"
        label="Codigo recibido"
        onChangeText={setResetToken}
        placeholder="REC-1234ABCD"
        value={resetToken}
      />
      <AppTextInput
        label="Nueva contrasena"
        onChangeText={setResetPassword}
        secureTextEntry
        value={resetPassword}
      />
      <AppTextInput
        label="Confirmar contrasena"
        onChangeText={setResetConfirmPassword}
        secureTextEntry
        value={resetConfirmPassword}
      />
      <AppButton
        disabled={resetLoading}
        onPress={handleResetPassword}
        title={resetLoading ? 'Guardando...' : 'Restablecer contrasena'}
      />
      <AppButton onPress={() => setAuthMode('requestReset')} title="Pedir otro codigo" variant="secondary" />
      <AppButton onPress={backToLogin} title="Volver al login" variant="link" />
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.logoBox}>
          <Text style={styles.logo}>Auxi<Text style={{ color: colors.accent }}>o</Text>n</Text>
          <Text style={styles.subtitle}>Ingresa para participar o cargar tus articulos</Text>
        </View>

        <View style={styles.card}>
          {!isConnected ? <ErrorBanner message="Sin conexion. Revisa tu internet antes de iniciar sesion." /> : null}
          <ErrorBanner message={error} />
          <ErrorBanner message={resetMessage} type="info" />
          {authMode === 'requestReset'
            ? renderRequestReset()
            : authMode === 'confirmReset'
              ? renderConfirmReset()
              : renderLogin()}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  container: {
    flex: 1,
    gap: spacing.xl,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  logoBox: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  logo: {
    color: colors.primary,
    fontSize: 40,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: typography.body,
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '900',
  },
  passwordRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 8,
  },
  eyeButton: {
    paddingBottom: 12,
    paddingHorizontal: 4,
  },
  toggleText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '800',
  },
});
