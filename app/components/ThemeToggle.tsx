"use client";

import { useTheme } from "../hooks/useTheme";
import styles from "./ThemeToggle.module.css";

export default function ThemeToggle() {
  const { theme, toggle, mounted } = useTheme();

  return (
    <button
      onClick={toggle}
      className={styles.toggleBtn}
      title={theme === "light" ? "切换到暗色模式" : "切换到亮色模式"}
      suppressHydrationWarning
    >
      <span suppressHydrationWarning>
        {mounted ? (theme === "light" ? "🌙" : "☀️") : ""}
      </span>
    </button>
  );
}
