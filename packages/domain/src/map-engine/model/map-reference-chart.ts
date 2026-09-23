export type MapReferenceCalibration = {
  seatDiameter: number;
  seatPitch: number;
  rowPitch: number;
};

export type MapReferenceTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type MapReferenceChart = {
  url: string;
  storageKey: string | null;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  visible: boolean;
  opacity: number;
  locked: boolean;
  transform: MapReferenceTransform;
  calibration: MapReferenceCalibration | null;
};

export const DEFAULT_MAP_REFERENCE_TRANSFORM: MapReferenceTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
};

export function normalizeMapReferenceChart(value: unknown): MapReferenceChart | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<MapReferenceChart>;
  if (
    typeof candidate.url !== 'string' ||
    typeof candidate.fileName !== 'string' ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(candidate.mimeType ?? '') ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height)
  ) return null;

  const width = candidate.width;
  const height = candidate.height;
  if (typeof width !== 'number' || typeof height !== 'number') return null;

  const transform = candidate.transform;
  if (!transform || !Number.isFinite(transform.x) || !Number.isFinite(transform.y) || !Number.isFinite(transform.scale) || !Number.isFinite(transform.rotation) || transform.scale <= 0) {
    return null;
  }

  const calibration = candidate.calibration;
  const normalizedCalibration = calibration &&
    Number.isFinite(calibration.seatDiameter) && calibration.seatDiameter > 0 &&
    Number.isFinite(calibration.seatPitch) && calibration.seatPitch >= 0 &&
    Number.isFinite(calibration.rowPitch) && calibration.rowPitch >= 0
    ? {
        seatDiameter: calibration.seatDiameter,
        seatPitch: calibration.seatPitch,
        rowPitch: calibration.rowPitch,
      }
    : null;
  const opacity = typeof candidate.opacity === 'number' && Number.isFinite(candidate.opacity)
    ? Math.min(1, Math.max(0.05, candidate.opacity))
    : 0.5;

  return {
    url: candidate.url,
    storageKey: typeof candidate.storageKey === 'string' ? candidate.storageKey : null,
    fileName: candidate.fileName,
    mimeType: candidate.mimeType as MapReferenceChart['mimeType'],
    width,
    height,
    visible: candidate.visible !== false,
    opacity,
    locked: candidate.locked !== false,
    transform: {
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
      rotation: transform.rotation,
    },
    calibration: normalizedCalibration,
  };
}
