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
import { colors, radius, spacing, typography } from '../constants/theme';

const MIN_IMAGES = 6;
const DECLARACION_PROPIEDAD =
  'Declaro bajo juramento ser el legitimo propietario de este articulo o tener los derechos para venderlo.';
const ACEPTACION_DEVOLUCION =
  'Acepto que, si la empresa no acepta el bien tras su revision fisica, asumire los costos de devolucion correspondientes.';

const getAssetName = (asset) => {
  if (asset?.fileName) return asset.fileName;
  if (!asset?.uri) return 'Archivo seleccionado';
  return asset.uri.split(/[\\/]/).pop() || 'Archivo seleccionado';
};

const toSelectedImage = (asset) => ({
  uri: asset.uri,
  name: getAssetName(asset),
});

export default function PublishItemScreen({ navigation }) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [precioEstimado, setPrecioEstimado] = useState('');
  const [infoHistorica, setInfoHistorica] = useState('');
  const [images, setImages] = useState([]);
  const [certificado, setCertificado] = useState(null);
  const [checkPropietario, setCheckPropietario] = useState(false);
  const [checkDevolucion, setCheckDevolucion] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets) {
      setImages((prev) => {
        const seen = new Set(prev.map((image) => image.uri));
        const next = [...prev];
        result.assets.forEach((asset) => {
          if (asset.uri && !seen.has(asset.uri)) {
            next.push(toSelectedImage(asset));
            seen.add(asset.uri);
          }
        });
        return next;
      });
    }
  };

  const pickCertificado = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setCertificado(toSelectedImage(result.assets[0]));
    }
  };

  const removeImage = (uri) => {
    setImages((prev) => prev.filter((image) => image.uri !== uri));
  };

  const ensureCuentaCobro = async () => {
    const data = await apiRequest('/usuarios/me/perfil');
    const cuenta = data?.profile?.cuentaCobro;
    if (!cuenta?.banco || !cuenta?.cbu || !cuenta?.alias) {
      throw new Error(
        'Antes de publicar artículos, configurá tu cuenta de cobro desde Mi cuenta para poder recibir el dinero de futuras ventas.',
      );
    }
  };

  const validate = () => {
    if (!titulo.trim()) return 'El título es obligatorio';
    if (!descripcion.trim()) return 'La descripción es obligatoria';
    if (images.length < MIN_IMAGES) return `Se requieren al menos ${MIN_IMAGES} imágenes`;
    if (!certificado) return 'Debés adjuntar el documento o certificado de origen lícito';
    if (!checkPropietario) return 'Debés declarar ser el legítimo propietario';
    if (!checkDevolucion) return 'Debés aceptar las condiciones de devolución';
    return '';
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
      await ensureCuentaCobro();
      const response = await apiRequest('/articulos/propuesta', {
        method: 'POST',
        body: {
          titulo: titulo.trim(),
          descripcion: descripcion.trim(),
          fotos: images.map((image) => image.uri),
          informacion_historica: infoHistorica.trim() || null,
          documento_origen: certificado.uri,
          declaracion_propiedad: DECLARACION_PROPIEDAD,
          acepta_devolucion_con_cargo: checkDevolucion,
          precio_estimado: precioEstimado.trim() || null,
        },
      });
      const createdArticleId = response?.article?.id || response?.id_articulo;
      if (createdArticleId) {
        navigation.replace('ItemTracking', {
          articleId: createdArticleId,
          message: response?.message || 'Propuesta enviada correctamente.',
        });
      } else {
        navigation.replace('MyItems');
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const renderImageGrid = () => {
    const totalSlots = Math.max(MIN_IMAGES, images.length + 1);
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      if (i < images.length) {
        const image = images[i];
        slots.push(
          <View key={image.uri} style={styles.gridSlot}>
            <Image source={{ uri: image.uri }} style={styles.gridImage} />
            <Pressable style={styles.gridRemoveButton} onPress={() => removeImage(image.uri)} hitSlop={8}>
              <Text style={styles.gridRemoveText}>x</Text>
            </Pressable>
          </View>,
        );
      } else {
        slots.push(
          <Pressable key={i} style={styles.gridSlotEmpty} onPress={pickImages}>
            <Text style={styles.gridPlus}>+</Text>
          </Pressable>,
        );
      }
    }
    return <View style={styles.imageGrid}>{slots}</View>;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
            <Text style={styles.backArrow}>{'<'}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Publicar artículo</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ErrorBanner message={error} />

          <View style={styles.card}>
            <AppTextInput label="Título" onChangeText={setTitulo} placeholder="Nombre del artículo" value={titulo} />
            <AppTextInput
              label="Descripción"
              multiline
              numberOfLines={4}
              onChangeText={setDescripcion}
              placeholder="Describí el artículo"
              style={styles.multiline}
              value={descripcion}
            />
            <AppTextInput
              label="Precio estimado en USD (orientativo)"
              keyboardType="numeric"
              onChangeText={setPrecioEstimado}
              placeholder="Ej: 500"
              value={precioEstimado}
            />
            <Text style={styles.fieldHint}>
              Es solo una referencia. La empresa define el valor base, la moneda final y la comisión al revisar el artículo.
            </Text>
            <AppTextInput
              label="Información histórica o contexto (Opcional)"
              multiline
              numberOfLines={3}
              onChangeText={setInfoHistorica}
              placeholder="Datos históricos, procedencia, contexto relevante"
              style={styles.multiline}
              value={infoHistorica}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Imágenes del artículo</Text>
            <Pressable style={styles.mainUploadBox} onPress={pickImages}>
              <Text style={styles.uploadIcon}>IMG</Text>
              <Text style={styles.uploadText}>Tocar para subir imágenes</Text>
              <Text style={styles.uploadHint}>Formatos JPG o PNG, máximo 5MB</Text>
            </Pressable>
            {renderImageGrid()}
            <Text style={styles.imageRequirement}>Se requieren al menos {MIN_IMAGES} imágenes para poder enviar el artículo</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Acreditación de origen lícito</Text>
            <View style={styles.attachRow}>
              <Pressable style={styles.attachMain} onPress={pickCertificado}>
                <Text style={styles.attachIcon}>DOC</Text>
                <View style={styles.attachCopy}>
                  <Text style={styles.attachText}>
                    {certificado ? certificado.name : 'Adjuntar documento o certificado'}
                  </Text>
                  {certificado && <Text style={styles.attachSubtext}>Documento seleccionado</Text>}
                </View>
              </Pressable>
              {certificado && (
                <Pressable style={styles.attachRemove} onPress={() => setCertificado(null)} hitSlop={8}>
                  <Text style={styles.attachRemoveText}>Quitar</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Pressable style={styles.checkRow} onPress={() => setCheckPropietario((v) => !v)}>
              <View style={[styles.checkbox, checkPropietario && styles.checkboxChecked]}>
                {checkPropietario && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>{DECLARACION_PROPIEDAD}</Text>
            </Pressable>

            <Pressable style={styles.checkRow} onPress={() => setCheckDevolucion((v) => !v)}>
              <View style={[styles.checkbox, checkDevolucion && styles.checkboxChecked]}>
                {checkDevolucion && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>{ACEPTACION_DEVOLUCION}</Text>
            </Pressable>
          </View>

          <AppButton disabled={loading} onPress={handleSubmit} title={loading ? 'Enviando...' : 'Enviar a revisión'} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backArrow: { color: colors.primary, fontSize: 22, fontWeight: '700' },
  headerTitle: { color: colors.text, fontSize: typography.subtitle, fontWeight: '900' },
  scroll: { gap: spacing.md, padding: spacing.lg, paddingTop: spacing.sm },
  card: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  fieldHint: { color: colors.muted, fontSize: typography.small, marginTop: -spacing.sm },
  multiline: { textAlignVertical: 'top' },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  mainUploadBox: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  uploadIcon: { color: colors.muted, fontSize: 18, fontWeight: '800' },
  uploadText: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  uploadHint: { color: colors.muted, fontSize: typography.small },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridSlot: { borderRadius: radius.sm, height: 90, overflow: 'hidden', position: 'relative', width: '30.5%' },
  gridImage: { height: '100%', width: '100%' },
  gridRemoveButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.75)',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 20,
  },
  gridRemoveText: { color: colors.white, fontSize: 12, fontWeight: '800', lineHeight: 14 },
  gridSlotEmpty: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    height: 90,
    justifyContent: 'center',
    width: '30.5%',
  },
  gridPlus: { color: colors.muted, fontSize: 28, fontWeight: '300' },
  imageRequirement: { color: colors.muted, fontSize: typography.small },
  attachRow: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  attachMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  attachIcon: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  attachCopy: { flex: 1 },
  attachText: { color: colors.primary, fontSize: typography.body, fontWeight: '600' },
  attachSubtext: { color: colors.muted, fontSize: typography.small, marginTop: 2 },
  attachRemove: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  attachRemoveText: { color: colors.danger, fontSize: typography.small, fontWeight: '700' },
  checkRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  checkbox: { alignItems: 'center', borderColor: colors.border, borderRadius: 4, borderWidth: 2, height: 22, justifyContent: 'center', marginTop: 2, width: 22 },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.white, fontSize: 14, fontWeight: '700' },
  checkLabel: { color: colors.text, flex: 1, fontSize: typography.small, lineHeight: 18 },
});
