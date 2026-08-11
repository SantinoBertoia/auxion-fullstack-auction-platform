import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import AppButton from '../components/AppButton';
import AppTextInput from '../components/AppTextInput';
import ErrorBanner from '../components/ErrorBanner';
import { apiRequest } from '../services/apiClient';
import { saveSession } from '../storage/authStorage';
import { colors, radius, spacing, typography } from '../constants/theme';
import { formatPaymentType } from '../utils/formatters';
import {
  PAYMENT_CURRENCIES,
  PAYMENT_TYPES,
  buildPaymentPayload,
  validatePaymentPayload,
} from '../utils/paymentValidation';

const initialPayment = {
  tipo: 'tarjeta',
  moneda: 'USD',
  alias: '',
  banco: '',
  numero: '',
  montoGarantia: '',
};

const getAssetName = (asset) => {
  if (asset?.fileName) return asset.fileName;
  if (!asset?.uri) return 'Imagen seleccionada';
  return asset.uri.split(/[\\/]/).pop() || 'Imagen seleccionada';
};

const toSelectedImage = (asset) => ({
  uri: asset.uri,
  name: getAssetName(asset),
});

export default function RegisterScreen({ navigation, route }) {
  const isComplete = route.params?.mode === 'complete';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tokenRegistro, setTokenRegistro] = useState(route.params?.token || '');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [documento, setDocumento] = useState('');
  const [pais, setPais] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [dniFrente, setDniFrente] = useState(null);
  const [dniDorso, setDniDorso] = useState(null);
  const [medioPago, setMedioPago] = useState(initialPayment);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pickImage = async (side) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.length) {
      const selected = toSelectedImage(result.assets[0]);
      if (side === 'frente') {
        setDniFrente(selected);
      } else {
        setDniDorso(selected);
      }
    }
  };

  const updatePayment = (field, value) => {
    setMedioPago((current) => ({ ...current, [field]: value }));
  };

  const validate = () => {
    if (isComplete) {
      if (!tokenRegistro.trim()) return 'El codigo de registro es obligatorio';
      if (!password.trim()) return 'La contrasena es obligatoria';
      if (password.length < 6) return 'La contrasena debe tener al menos 6 caracteres';
      if (password !== confirmPassword) return 'Las contrasenas no coinciden';
      return validatePaymentPayload(medioPago);
    }

    if (!email.trim()) return 'Email es obligatorio';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'Ingresa un email valido';
    if (!nombre.trim() || !apellido.trim()) return 'Nombre y apellido son obligatorios';
    if (!documento.trim()) return 'El documento es obligatorio';
    if (!pais.trim()) return 'Indica tu pais de origen';
    if (!domicilio.trim()) return 'Indica tu domicilio legal';
    if (!dniFrente || !dniDorso) return 'Debes subir ambos lados del documento de identidad';
    return '';
  };

  const getPaymentNumberLabel = () => {
    if (medioPago.tipo === 'tarjeta') return 'Numero de tarjeta';
    if (medioPago.tipo === 'cuenta_bancaria') return 'CBU, CVU, IBAN o cuenta';
    return 'Numero de cheque';
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (isComplete) {
        const data = await apiRequest('/usuarios/confirmar-registro', {
          method: 'POST',
          auth: false,
          body: {
            token_registro: tokenRegistro.trim(),
            password,
            confirmPassword,
            medioPago: buildPaymentPayload(medioPago),
          },
        });
        await saveSession(data);
        navigation.replace('Auctions', { guest: false });
        return;
      }

      const data = await apiRequest('/usuarios/pre-registro', {
        method: 'POST',
        auth: false,
        body: {
          email: email.trim(),
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          documento: documento.trim(),
          pais: pais.trim(),
          domicilio: domicilio.trim(),
          imagenDniDorso: dniDorso.uri,
          imagenDniFrente: dniFrente.uri,
        },
      });
      navigation.replace('PendingApproval', {
        email: email.trim(),
        preRegistro: data.preRegistro,
        message: data.message,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
            <Text style={styles.backArrow}>{'<'}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{isComplete ? 'Completar registro' : 'Registro'}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ErrorBanner message={error} />

          <View style={styles.card}>
            {isComplete ? (
              <>
                <AppTextInput
                  autoCapitalize="characters"
                  label="Codigo de registro"
                  onChangeText={setTokenRegistro}
                  placeholder="AUX-1234ABCD"
                  value={tokenRegistro}
                />
                <AppTextInput
                  label="Nueva contrasena"
                  onChangeText={setPassword}
                  placeholder="Ingresa tu contrasena"
                  secureTextEntry
                  value={password}
                />
                <AppTextInput
                  label="Confirmar contrasena"
                  onChangeText={setConfirmPassword}
                  placeholder="Repite tu contrasena"
                  secureTextEntry
                  value={confirmPassword}
                />
              </>
            ) : (
              <>
                <AppTextInput
                  autoCapitalize="none"
                  keyboardType="email-address"
                  label="Email de contacto"
                  onChangeText={setEmail}
                  placeholder="nombre@email.com"
                  value={email}
                />
                <AppTextInput label="Nombre" onChangeText={setNombre} placeholder="Tu nombre" value={nombre} />
                <AppTextInput label="Apellido" onChangeText={setApellido} placeholder="Tu apellido" value={apellido} />
                <AppTextInput
                  keyboardType="numeric"
                  label="Documento"
                  onChangeText={setDocumento}
                  placeholder="Numero de documento"
                  value={documento}
                />
                <AppTextInput label="Pais de origen" onChangeText={setPais} placeholder="Ej: Argentina" value={pais} />
                <AppTextInput
                  label="Domicilio legal"
                  onChangeText={setDomicilio}
                  placeholder="Tu domicilio legal"
                  value={domicilio}
                />
              </>
            )}
          </View>

          {isComplete ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Medio de pago</Text>
              <View style={styles.row}>
                {PAYMENT_TYPES.map((type) => (
                  <AppButton
                    key={type}
                    onPress={() => updatePayment('tipo', type)}
                    title={formatPaymentType(type)}
                    variant={medioPago.tipo === type ? 'primary' : 'secondary'}
                    style={styles.smallButton}
                  />
                ))}
              </View>
              <View style={styles.row}>
                {PAYMENT_CURRENCIES.map((currency) => (
                  <AppButton
                    key={currency}
                    onPress={() => updatePayment('moneda', currency)}
                    title={currency}
                    variant={medioPago.moneda === currency ? 'primary' : 'secondary'}
                    style={styles.smallButton}
                  />
                ))}
              </View>
              <AppTextInput label="Alias" onChangeText={(value) => updatePayment('alias', value)} value={medioPago.alias} />
              <AppTextInput label="Banco" onChangeText={(value) => updatePayment('banco', value)} value={medioPago.banco} />
              <AppTextInput
                keyboardType={medioPago.tipo === 'tarjeta' ? 'numeric' : 'default'}
                label={getPaymentNumberLabel()}
                onChangeText={(value) => updatePayment('numero', value)}
                value={medioPago.numero}
              />
              <AppTextInput
                keyboardType="numeric"
                label="Monto de garantia"
                onChangeText={(value) => updatePayment('montoGarantia', value)}
                value={medioPago.montoGarantia}
              />
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Documento de identidad</Text>
              <View style={styles.dniRow}>
                <Pressable style={[styles.dniBox, dniFrente && styles.dniBoxDone]} onPress={() => pickImage('frente')}>
                  {dniFrente ? (
                    <>
                      <Image source={{ uri: dniFrente.uri }} style={styles.dniPreview} />
                      <Text style={styles.dniFileName} numberOfLines={1}>{dniFrente.name}</Text>
                      <Pressable style={styles.dniRemove} onPress={() => setDniFrente(null)} hitSlop={8}>
                        <Text style={styles.dniRemoveText}>Quitar</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Text style={styles.dniIcon}>IMG</Text>
                      <Text style={styles.dniLabel}>DNI frente</Text>
                      <Text style={styles.dniSublabel}>Tocar para subir</Text>
                    </>
                  )}
                </Pressable>
                <Pressable style={[styles.dniBox, dniDorso && styles.dniBoxDone]} onPress={() => pickImage('dorso')}>
                  {dniDorso ? (
                    <>
                      <Image source={{ uri: dniDorso.uri }} style={styles.dniPreview} />
                      <Text style={styles.dniFileName} numberOfLines={1}>{dniDorso.name}</Text>
                      <Pressable style={styles.dniRemove} onPress={() => setDniDorso(null)} hitSlop={8}>
                        <Text style={styles.dniRemoveText}>Quitar</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Text style={styles.dniIcon}>IMG</Text>
                      <Text style={styles.dniLabel}>DNI dorso</Text>
                      <Text style={styles.dniSublabel}>Tocar para subir</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <AppButton
            disabled={loading}
            onPress={handleSubmit}
            title={loading ? 'Enviando...' : isComplete ? 'Completar registro' : 'Enviar solicitud'}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backArrow: { color: colors.primary, fontSize: 22, fontWeight: '700' },
  headerTitle: { color: colors.text, fontSize: typography.subtitle, fontWeight: '900' },
  scroll: { gap: spacing.md, padding: spacing.lg, paddingTop: spacing.sm },
  card: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  smallButton: { flexGrow: 1 },
  dniRow: { flexDirection: 'row', gap: spacing.md },
  dniBox: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  dniBoxDone: { borderColor: colors.success, borderStyle: 'solid' },
  dniIcon: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  dniLabel: { color: colors.muted, fontSize: typography.small, fontWeight: '600' },
  dniPreview: { width: '100%', height: 80, borderRadius: 6 },
  dniFileName: { color: colors.text, fontSize: 11, maxWidth: '100%' },
  dniRemove: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  dniRemoveText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  dniSublabel: { color: colors.muted, fontSize: 11 },
});
