import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auxion_token';
const USER_KEY = 'auxion_user';

export const saveSession = async ({ token, user }) => {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, token],
    [USER_KEY, JSON.stringify(user)],
  ]);
};

export const getAuthToken = async () => {
  return AsyncStorage.getItem(TOKEN_KEY);
};

export const getStoredUser = async () => {
  const rawUser = await AsyncStorage.getItem(USER_KEY);
  return rawUser ? JSON.parse(rawUser) : null;
};

export const getSession = async () => {
  const [token, user] = await Promise.all([getAuthToken(), getStoredUser()]);
  return { token, user };
};

export const clearSession = async () => {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
};
