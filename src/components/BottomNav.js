import { StyleSheet, Text, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '../constants/theme';

const items = [
  { key: 'Auctions', label: 'Subastas', icon: 'pricetag-outline', iconActive: 'pricetag' },
  { key: 'Activity', label: 'Actividad', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { key: 'MyItems', label: 'Mis artículos', icon: 'cube-outline', iconActive: 'cube' },
  { key: 'Account', label: 'Mi cuenta', icon: 'person-outline', iconActive: 'person' },
];

export default function BottomNav({ navigation, active, guest }) {
  const go = (screen) => {
    navigation.navigate(screen, { guest });
  };

  return (
    <View style={styles.nav}>
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <Pressable key={item.key} onPress={() => go(item.key)} style={styles.item}>
            <Ionicons
              name={isActive ? item.iconActive : item.icon}
              size={22}
              color={isActive ? colors.primary : colors.muted}
            />
            <Text style={[styles.label, isActive && styles.active]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  item: {
    alignItems: 'center',
    gap: 2,
    minWidth: 72,
    paddingVertical: spacing.xs,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  active: {
    color: colors.primary,
  },
});
