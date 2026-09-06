import { Toaster as Sonner } from "sonner";

import { useUi } from "@/stores/ui";

/** sonner 封装：主题跟随站点 light/dark；触点克制（仅全局性操作） */
const Toaster = () => {
  const theme = useUi((s) => s.theme);

  return (
    <Sonner
      theme={theme}
      richColors
      position="top-center"
      duration={2500}
      toastOptions={{
        classNames: {
          toast: "rounded-lg border shadow-md text-sm",
        },
      }}
    />
  );
};

export { Toaster };
