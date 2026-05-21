"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "theme";

type Theme = "light" | "dark";

export function useTheme() {
  // 从 html 标签上读取当前 data-theme（layout 中的 script 已设置）
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") return attr;
    }
    return "light";
  });

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
