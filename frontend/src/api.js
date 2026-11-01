import axios from 'axios';
import { isSessionExpired } from './lib/sessionExpiry';

export const TOKEN_KEY = 'iam_auth_token_v1';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isSessionExpired(error)) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new Event('iam:unauthorized'));
    }
    return Promise.reject(error);
  }
);

export function errorMessage(error, fallback = 'Something went wrong.') {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => (typeof d === 'string' ? d : d?.msg || JSON.stringify(d)))
      .join('; ');
  }
  if (error?.message === 'Network Error' || error?.code === 'ERR_NETWORK') {
    return 'Could not reach the API. The backend may not be running — start it with '
      + '`flask --app app.main run --port 8000` in the backend folder, then retry.';
  }
  return error?.message || fallback;
}

export default api;
