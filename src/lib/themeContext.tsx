'use client';

import { createContext, useContext } from 'react';

// Brand v2: dark theme is fixed. `data-theme="night"` is baked into the static
// HTML in layout.tsx, so there is nothing to read, set, or sync at runtime —
// no localStorage, no DOM mutation, no effect. The context is kept (same
// `theme`/`toggle` shape) only so existing consumers don't break; `theme` is
// permanently 'night' and `toggle` is a no-op. Any `isDay ? … : …` branch in
// the app resolves to dark.
export type Theme = 'night' | 'day';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'night', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <Ctx.Provider value={{ theme: 'night', toggle: () => {} }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
