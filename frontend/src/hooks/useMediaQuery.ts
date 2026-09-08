import { useEffect, useState } from "react";

/**
 * 响应式断点订阅。用于「同一组件在移动/桌面渲染不同容器」的场景
 * （如 Dialog ↔ 底部抽屉），这类差异无法用纯 CSS 表达。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** 桌面断点（与 Tailwind md 一致：768px） */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}
