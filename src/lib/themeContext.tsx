'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'night' | 'day';

const STORAGE_KEY = 'wr-theme';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'night', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('night');

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'night';
    setTheme(stored);
    // Ensure the DOM attribute is always in sync with the stored value
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  const toggle = () => {
    setTheme(prev => {
      const next: Theme = prev === 'night' ? 'day' : 'night';
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  };

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
