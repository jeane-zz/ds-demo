"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "theme";

type Theme = "light" | "dark";

export function useTheme() {
  // SSR 与首屏 hydration 必须输出一致内容，所以初始值统一为 "light"
  // mounted=false 时调用方应渲染占位，避免文本不匹配
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // 挂载后再从 layout 注入 script 设置好的 data-theme 同步真实主题
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") {
      setTheme(attr);
    }
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  return { theme, toggle, mounted };
}
