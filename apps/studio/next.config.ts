import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  // 注：曾设 output:'standalone' 给 Docker 用，但在 Vercel + Turbopack 下会要求
  // .next/next-server.js.nft.json 而缺失导致构建失败，已移除（Vercel 不需要 standalone）。
  // 实测坑：Next 16 dev 默认拒绝跨源 dev 资源。用 http://127.0.0.1:3200 访问时
  // HTML 返回 200 但 JS/CSS chunk 全 403 → 后台一片空白，只报 WebSocket 失败。
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    // monorepo：node_modules 提升到仓库根，root 必须指到根，否则 Next 16 拒绝编译
    // 上层文件并报「workspace root is incorrect」（实测踩到：/admin 直接 404）。
    root: path.resolve(dirname, '../..'),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
