/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 开发期使用 mocks/programs.ts 假数据：设为 "1" 开启 */
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
