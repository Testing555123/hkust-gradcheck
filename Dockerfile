# syntax=docker/dockerfile:1

# ============ Stage 1: 前端构建 ============
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build

# ============ Stage 2: 后端运行时 + 数据烘焙 ============
# 镜像内保持与仓库一致的相对布局（PROJECT_ROOT=/app），
# 使 backend 默认配置（courses.db / backend/data / static）无需任何环境变量即可工作。
FROM python:3.11-slim
WORKDIR /app

RUN pip install --no-cache-dir fastapi "uvicorn[standard]" sqlmodel pydantic pydantic-settings

COPY backend/ backend/
COPY pipeline/output/ pipeline/output/
COPY courses.db .
COPY --from=frontend-build /app/dist/ static/

# 构建时烘焙 grad.db：复制 courses.db -> backend/data/grad.db 并导入 requirement 表，
# 冷启动零数据初始化。seed 幂等（按 year+code 重建式写入）。
RUN python backend/scripts/seed.py

EXPOSE 8000
WORKDIR /app/backend
# Render 注入 PORT 环境变量；本地默认 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
