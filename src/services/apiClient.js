import { API_BASE_URL } from '../config/api';
import { getAuthToken } from '../storage/authStorage';

const parseResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
};

export const apiRequest = async (path, options = {}) => {
  const token = await getAuthToken();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token && options.auth !== false) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    const networkError = new Error('No se pudo conectar con el backend');
    networkError.status = 0;
    throw networkError;
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    const requestError = new Error(data?.message || 'Ocurrió un error inesperado');
    requestError.status = response.status;
    requestError.data = data;
    throw requestError;
  }

  return data;
};
