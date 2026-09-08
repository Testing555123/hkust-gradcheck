import { cn } from "@/lib/utils";
import { useUi, type AppView } from "@/stores/ui";
import type { NavItem } from "@/components/layout/SideNav";

interface MobileTabBarProps {
  items: NavItem[];
  className?: string;
}

/** 移动端底部导航：固定底栏，适配安全区，当前项以图标 + 文字高亮表达 */
export function MobileTabBar({ items, className }: MobileTabBarProps) {
  const activeView = useUi((s) => s.activeView);
  const setView = useUi((s) => s.setView);

  return (
    <nav
      aria-label="底部导航"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70",
        className
      )}
    >
      <div className="mx-auto flex max-w-md items-stretch pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active = activeView === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setView(item.key as AppView)}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors duration-150",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {typeof item.count === "number" && item.count > 0 && (
                  <span
                    className={cn(
                      "absolute -right-2 -top-1.5 min-w-[15px] rounded-full px-1 text-[9px] leading-[15px] tabular-nums",
                      item.countTone === "warning"
                        ? "bg-warning text-white"
                        : "bg-surface-3 text-muted-foreground"
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </span>
              <span className="font-medium">{item.label}</span>
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary transition-opacity duration-150",
                  active ? "opacity-100" : "opacity-0"
                )}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
