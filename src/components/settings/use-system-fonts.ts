import { useEffect, useState } from "react";

import { loadSystemFonts } from "@/lib/fonts";
import type { SystemFont } from "@/types";

/**
 * Families installed on this machine. The underlying call is memoised, so every
 * picker sharing this hook still costs a single round trip.
 */
export function useSystemFonts(): SystemFont[] {
  const [fonts, setFonts] = useState<SystemFont[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadSystemFonts()
      .then((list) => {
        if (!cancelled) setFonts(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return fonts;
}
