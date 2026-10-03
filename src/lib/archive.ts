import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Archive } from './journal';
import { demo } from './demo';
export const desktop = isTauri();
export async function loadArchive(root?: string): Promise<Archive> {
  return desktop
    ? invoke<Archive>('load_archive', { root: root || null })
    : demo;
}
export async function chooseArchive(): Promise<string | null> {
  if (!desktop) return null;
  const result = await open({
    directory: true,
    multiple: false,
    title: 'Choose your journal folder',
  });
  return typeof result === 'string' ? result : null;
}
export function readPreference<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem(`leaflet:${key}`) || 'null') ?? fallback
    );
  } catch {
    return fallback;
  }
}
export function savePreference(key: string, value: unknown) {
  try {
    localStorage.setItem(`leaflet:${key}`, JSON.stringify(value));
  } catch {
    /* Reading works even when storage is unavailable. */
  }
}
