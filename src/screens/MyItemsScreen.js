import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import BottomNav from '../components/BottomNav';
import ErrorBanner from '../components/ErrorBanner';
import StatusBadge from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing, typography } from '../constants/theme';

const getArticlePhoto = (item) => {
  if (Array.isArray(item.fotos) && item.fotos.length > 0) return item.fotos[0];
  return item.imagenFrente || item.imagenDorso || null;
};

const getArticleDisplayStatus = (item) => {
  if (item.estadoVisual) return item.estadoVisual;
  if (item.aceptaCondiciones === true) return 'condiciones_aceptadas';
  if (item.aceptaCondiciones === false) return 'condiciones_rechazadas';
  return item.estado;
};

export default function MyItemsScreen({ navigation, route }) {
  const guest = Boolean(route.params?.guest);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(!guest);
  const [error, setError] = useState('');

  const loadArticles = useCallback(async () => {
    if (guest) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/articulos');
      setArticles(data.articles || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [guest]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const renderItem = ({ item }) => {
    const imageUri = getArticlePhoto(item);

    return (
      <Pressable
        onPress={() => navigation.navigate('ItemTracking', { articleId: item.id, guest })}
        style={({ pressed }) => [styles.articleCard, pressed && styles.cardPressed]}
      >
        <View style={styles.articleThumb}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.articleImage} />
          ) : (
            <Text style={styles.articlePlaceholder}>IMG</Text>
          )}
        </View>
        <View style={styles.articleInfo}>
          <Text style={styles.articleTitle}>{item.titulo}</Text>
          <StatusBadge label={getArticleDisplayStatus(item)} />
        </View>
        <Text style={styles.chevron}>{'>'}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Mis artículos</Text>
      </View>

      {guest ? (
        <View style={styles.restrictedCard}>
          <Text style={styles.sectionTitle}>Acceso restringido</Text>
          <Text style={styles.meta}>Iniciá sesión para ver tus artículos publicados.</Text>
          <AppButton onPress={() => navigation.replace('Login')} title="Ir al login" />
        </View>
      ) : (
        <View style={styles.listContainer}>
          <ErrorBanner message={error} />

          <AppButton
            onPress={() => navigation.navigate('PublishItem', { guest })}
            title="+ Publicar artículo"
          />

          {loading ? (
            <ActivityIndicator color={colors.primary} size="large" style={styles.loader} />
          ) : (
            <>
              {articles.length > 0 && (
                <Text style={styles.sectionHeader}>Artículos cargados</Text>
              )}
              <FlatList
                data={articles}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <Text style={styles.meta}>No hay artículos publicados todavía.</Text>
                }
              />
            </>
          )}
        </View>
      )}

      <BottomNav active="MyItems" guest={guest} navigation={navigation} />
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
  restrictedCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    margin: spacing.lg,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  sectionHeader: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: typography.body,
  },
  listContainer: {
    flex: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  loader: {
    marginTop: spacing.xl,
  },
  articleCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  cardPressed: {
    opacity: 0.85,
  },
  articleThumb: {
    alignItems: 'center',
    backgroundColor: '#F2F4F7',
    borderRadius: radius.sm,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 56,
  },
  articleImage: {
    height: '100%',
    width: '100%',
  },
  articlePlaceholder: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  articleInfo: {
    flex: 1,
    gap: 4,
  },
  articleTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  chevron: {
    color: colors.muted,
    fontSize: 22,
  },
});
