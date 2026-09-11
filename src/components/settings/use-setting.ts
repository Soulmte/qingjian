import { useSettings } from "@/stores/settings";
import type { AppSettings } from "@/types";

/**
 * Reads one setting and returns a setter that persists it immediately.
 * Subscribing to a single key keeps each control from re-rendering when an
 * unrelated setting changes.
 */
export function useSetting<K extends keyof AppSettings>(key: K) {
  const value = useSettings((state) => state.settings[key]);
  const update = useSettings((state) => state.update);
  return [value, (next: AppSettings[K]) => update(key, next)] as const;
}
