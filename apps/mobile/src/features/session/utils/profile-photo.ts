export function resolveProfilePhotoUri(photo: string | null | undefined, apiUrl: string) {
  const value = photo?.trim();
  if (!value) return null;
  return value.startsWith('/') ? `${apiUrl}${value}` : value;
}
