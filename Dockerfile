# 单镜像：Payload 后台 + 读 API（+ 学生 SPA，见 §「打包边界」）
# 依据本会话实测：output:'standalone' 与 Payload 3.90.2 可用，standalone 产物 38 MB。
# monorepo 下 Next 会把 standalone 嵌套到 apps/studio/ 里，server.js 路径随之变化。

# 可覆盖的基础镜像来源：平台构建器能直连 Docker Hub，无需镜像；
# 本机实测 registry-1.docker.io / auth.docker.io 均被挡（HTTP 000），
# 因此本地构建需 --build-arg BASE_IMAGE=docker.m.daocloud.io/library/node:24-slim。
# 把镜像源硬编进 Dockerfile 会让别人的构建器绑死在第三方上，故用 ARG。
ARG BASE_IMAGE=node:24-slim

FROM ${BASE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 HUSKY=0

# 先只拷清单，让依赖层可被缓存（改业务代码不重跑 npm ci）
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY packages/domain/package.json packages/domain/
COPY apps/studio/package.json apps/studio/
RUN npm ci --no-audit --no-fund

COPY . .
# 构建期不需要真库连接：payload.config 读的是 env，缺省时为空串
RUN npm -w @newone/studio run build

FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# 只带 standalone（含被裁剪过的 node_modules）+ 静态资源，不带源码与 devDeps
COPY --from=build /app/apps/studio/.next/standalone ./
COPY --from=build /app/apps/studio/.next/static ./apps/studio/.next/static

EXPOSE 3000
# 健康检查：平台靠它决定要不要把流量切过来（Render/Railway/Fly 都支持）
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/admin').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/studio/server.js"]
