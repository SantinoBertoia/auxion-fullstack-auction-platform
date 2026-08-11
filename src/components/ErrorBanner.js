import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';

export default function ErrorBanner({ message, type = 'error' }) {
  if (!message) {
    return null;
  }

  const isInfo = type === 'info';

  return (
    <View style={[styles.banner, isInfo && styles.info]}>
      <Text style={[styles.text, isInfo && styles.infoText]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FEE4E2',
    borderColor: '#FDA29B',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  info: {
    backgroundColor: '#E0F2FE',
    borderColor: '#7CD4FD',
  },
  text: {
    color: colors.danger,
    fontSize: typography.small,
    fontWeight: '600',
  },
  infoText: {
    color: colors.primary,
  },
});
