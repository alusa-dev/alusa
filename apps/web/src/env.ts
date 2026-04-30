export const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (process.env.NODE_ENV !== 'test' && !DATABASE_URL) {
  console.warn('DATABASE_URL não definido');
}
