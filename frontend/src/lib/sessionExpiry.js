export const INVALID_TOKEN_CODE = 'invalid_token';

export function isSessionExpired(error) {
  const response = error?.response;
  if (!response || response.status !== 401) return false;
  return response.data?.code === INVALID_TOKEN_CODE;
}
