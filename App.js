import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/LoginScreen';
import AuctionsScreen from './src/screens/AuctionsScreen';
import AuctionDetailScreen from './src/screens/AuctionDetailScreen';
import LotDetailScreen from './src/screens/LotDetailScreen';
import LiveAuctionScreen from './src/screens/LiveAuctionScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import AccountScreen from './src/screens/AccountScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import MyItemsScreen from './src/screens/MyItemsScreen';
import PublishItemScreen from './src/screens/PublishItemScreen';
import ItemTrackingScreen from './src/screens/ItemTrackingScreen';
import PendingApprovalScreen from './src/screens/PendingApprovalScreen';
import { colors } from './src/constants/theme';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen component={LoginScreen} name="Login" />
          <Stack.Screen component={AuctionsScreen} name="Auctions" />
          <Stack.Screen component={AuctionDetailScreen} name="AuctionDetail" />
          <Stack.Screen component={LotDetailScreen} name="LotDetail" />
          <Stack.Screen component={LiveAuctionScreen} name="LiveAuction" />
          <Stack.Screen component={ActivityScreen} name="Activity" />
          <Stack.Screen component={AccountScreen} name="Account" />
          <Stack.Screen component={RegisterScreen} name="Register" />
          <Stack.Screen component={MyItemsScreen} name="MyItems" />
          <Stack.Screen component={PublishItemScreen} name="PublishItem" />
          <Stack.Screen component={ItemTrackingScreen} name="ItemTracking" />
          <Stack.Screen component={PendingApprovalScreen} name="PendingApproval" />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
