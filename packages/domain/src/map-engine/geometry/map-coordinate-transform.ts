import type { MapPoint } from '../model/event-map-document.js';
import { toGlobal, toLocal } from './rotation.js';

export function sectionLocalToWorld(point: MapPoint, sectionPosition: MapPoint, sectionRotation: number) {
  return toGlobal(point, sectionPosition, sectionRotation);
}
export function worldToSectionLocal(point: MapPoint, sectionPosition: MapPoint, sectionRotation: number) {
  return toLocal(point, sectionPosition, sectionRotation);
}

export function mapPointsLocalToWorld(points: MapPoint[], sectionPosition: MapPoint, sectionRotation: number) {
  return points.map((point) => sectionLocalToWorld(point, sectionPosition, sectionRotation));
}
