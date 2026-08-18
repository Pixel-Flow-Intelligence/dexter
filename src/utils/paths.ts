import { join } from 'node:path';

const DEXTER_DIR = '.dexter';

export function getDexterDir(): string {
  const home = process.env.DEXTER_HOME?.trim();
  return home || DEXTER_DIR;
}

export function dexterPath(...segments: string[]): string {
  return join(getDexterDir(), ...segments);
}
