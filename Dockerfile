# UNETI Taxi AI: giao diện React + server Node (LLM orchestrator) + dịch vụ mô hình Python trong một container

# 1) Build giao diện
FROM node:20-slim AS web
WORKDIR /app
COPY web-app/package.json web-app/package-lock.json ./
RUN npm ci
COPY web-app/vite.config.js ./
COPY web-app/client ./client
RUN npm run build && npm prune --omit=dev

# 2) Ảnh chạy: Python cho mô hình, kèm Node để chạy server
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node

WORKDIR /app/web-app
COPY web-app/model_service/requirements.txt model_service/
RUN pip install --no-cache-dir -r model_service/requirements.txt

# Chỉ các file mô hình app cần (main.py đọc ../../final_model so với model_service/)
COPY final_model/lightgbm_final.pkl final_model/catboost_final.cbm final_model/submission.csv /app/final_model/
COPY web-app/model_service model_service
COPY web-app/server server
COPY web-app/package.json web-app/start.sh ./
COPY --from=web /app/node_modules node_modules
COPY --from=web /app/dist dist

ENV PORT=10000 MODEL_URL=http://127.0.0.1:8000 PYTHONUNBUFFERED=1
EXPOSE 10000
CMD ["bash", "start.sh"]
