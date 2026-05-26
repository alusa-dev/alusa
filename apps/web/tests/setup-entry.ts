if (process.env.MAP_CANVAS_UNIT === '1') {
  await import('../features/events/map/canvas/__tests__/setup.ts');
} else {
  await import('./setup.ts');
}
