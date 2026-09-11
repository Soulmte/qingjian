import { invoke } from "@tauri-apps/api/core";

import type { SystemFont } from "@/types";

/** Fallback stacks used when the user has not picked a font. */
export const UI_FONT_FALLBACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
export const MONO_FONT_FALLBACK = 'Consolas, "Cascadia Code", "Courier New", monospace';

/** Builds a CSS font stack, quoting the family name so spaces are safe. */
export function fontStack(family: string, fallback: string): string {
  return family ? `"${family}", ${fallback}` : fallback;
}

let cache: Promise<SystemFont[]> | null = null;

/**
 * Font families installed on this machine, scanned once by Rust and memoised
 * for the session. The promise itself is cached so concurrent callers share a
 * single round trip.
 */
export function loadSystemFonts(): Promise<SystemFont[]> {
  if (!cache) {
    cache = invoke<SystemFont[]>("list_system_fonts").catch((error) => {
      // A failed scan must not poison the cache for later attempts.
      cache = null;
      throw error;
    });
  }
  return cache;
}
