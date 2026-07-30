'use client';

import { createContext, useContext, useEffect } from 'react';

// Brand v2: dark theme is fixed. A light ("day") theme was removed per the
// brand handoff. The context is kept (same `theme`/`toggle` shape) so existing
// consumers don't break, but `theme` is permanently 'night' and `toggle` is a
// no-op. Any `isDay ? … : …` branch in the app now always resolves to dark.
export type Theme = 'night' | 'day';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'night', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Clear any stale day-mode preference and pin the DOM to dark.
    try {
      localStorage.setItem('wr-theme', 'night');
    } catch {}
    document.documentElement.setAttribute('data-theme', 'night');
  }, []);

  return <Ctx.Provider value={{ theme: 'night', toggle: () => {} }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
