"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "editorial" | "organic";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "organic",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("organic");

  useEffect(() => {
    const stored = localStorage.getItem("lms-theme") as Theme | null;
    if (stored === "editorial" || stored === "organic") {
      setThemeState(stored);
      document.documentElement.setAttribute("data-theme", stored);
    } else {
      localStorage.setItem("lms-theme", "organic");
      document.documentElement.setAttribute("data-theme", "organic");
    }
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem("lms-theme", t);
    document.documentElement.setAttribute("data-theme", t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
