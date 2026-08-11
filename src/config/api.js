const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:3000/api';

const normalizeApiBaseUrl = (value) => {
  const url = String(value || DEFAULT_LOCAL_API_BASE_URL).trim();
  return url.replace(/\/+$/, '');
};

export const API_BASE_URL = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
