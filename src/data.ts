// Shapes of the city data written by scripts/build_city.py (metres, x = east, z = south).
export interface Ring { outer: number[]; holes: number[][]; }
export interface Building extends Ring { h: number; mh: number; name: string; }
export interface Tier { h0: number; h1: number; rings: Ring[]; }
export interface Road { w: number; k: string; lv: number; p: number[]; }
export interface Rail { k: string; elev: number; p: number[]; }
export interface Area extends Ring { k: 'water' | 'green' | 'plaza' | 'site'; name: string; }
export interface City {
  origin: [number, number];
  tiers: Tier[];
  podium: Building[];
  buildings: Building[];
  roads: Road[];
  rail: Rail[];
  areas: Area[];
}

export async function loadCity(): Promise<City> {
  const r = await fetch('./data/city.json');
  if (!r.ok) throw new Error(`city data: HTTP ${r.status}`);
  return r.json();
}

export function ringArea(f: number[]) {
  let a = 0;
  for (let i = 0, n = f.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += f[i * 2] * f[j * 2 + 1] - f[j * 2] * f[i * 2 + 1];
  }
  return a / 2;
}

export function ringCentroid(f: number[]): [number, number] {
  let x = 0, z = 0;
  const n = f.length / 2;
  for (let i = 0; i < n; i++) { x += f[i * 2]; z += f[i * 2 + 1]; }
  return [x / n, z / n];
}

export function pointInRing(x: number, z: number, f: number[]) {
  let inside = false;
  for (let i = 0, n = f.length / 2, j = n - 1; i < n; j = i++) {
    const xi = f[i * 2], zi = f[i * 2 + 1], xj = f[j * 2], zj = f[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
