#!/usr/bin/env bash
# Bản chạy production (Docker / Render): dịch vụ mô hình chỉ mở nội bộ ở cổng 8000,
# server Node phục vụ giao diện đã build + API ở cổng $PORT. Một tiến trình dừng thì container dừng để Render khởi động lại.
python -m uvicorn main:app --app-dir model_service --host 127.0.0.1 --port 8000 &
node server/index.js &
wait -n
exit $?
