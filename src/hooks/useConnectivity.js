import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export const useConnectivity = () => {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(Boolean(state.isConnected && state.isInternetReachable !== false));
    });

    return unsubscribe;
  }, []);

  return { isConnected };
};
