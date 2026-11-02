# UNETI Taxi AI – Ứng dụng AI mini (Vòng 2)

Web dự đoán thời gian chuyến taxi New York, gồm:

- **Mô hình chính: LightGBM final** (`final_model/lightgbm_final.pkl`) – RMSLE kiểm định **0,3385**, thấp nhất so với
  CatBoost (0,3419) và blend 50/50 (0,3390). CatBoost được hiển thị kèm để đối chiếu.
- **Chatbot + LLM orchestrator** (OpenAI, mặc định `gpt-5.4-mini`): người dùng gõ điểm đi / điểm đến bằng ngôn ngữ tự
  nhiên, LLM tự gọi lần lượt các công cụ:
  1. `geocode_place` – tìm tọa độ (Google Geocoding nếu có key → OpenStreetMap Nominatim → Photon dự phòng)
  2. `get_route_distances` – backend lấy **khoảng cách chim bay** (haversine) và **quãng đường thực tế** theo đường
     phố (OSRM; thêm Google Distance Matrix nếu có key), rồi vẽ tuyến lên Google Maps
  3. `predict_trip_duration` – gửi các khoảng cách + thời điểm đón cho mô hình LightGBM
  4. `open_test_set` – khi người dùng hỏi về bộ Test ("Dự đoán trên bộ Test", "dự đoán chuyến T…"), LLM chuyển giao
     diện sang tab **Dự đoán (bộ Test)** và chạy mô hình trên cả bộ (so với submission.csv) hoặc trên một chuyến
- **Câu trả lời chatbot** luôn có thẻ theo thứ tự: ① tọa độ (vĩ độ, kinh độ) điểm đi / điểm đến → ② khoảng cách chim
  bay và đường thực tế → ③ kết quả dự đoán; bên dưới là nhận xét ngắn của LLM.
- **Bản đồ Google Maps** chỉ vẽ 2 đường: đường thực tế (nét liền, tuyến OSRM) và đường chim bay (nét đứt) – không hiện
  thời gian đi. Có `GOOGLE_MAPS_API_KEY`/`GOOGLE_MAPS_BROWSER_KEY` thì dùng Maps JavaScript API chính thức; chưa có key
  thì hiển thị nền bản đồ Google qua Leaflet.
- Các tab: **Chatbot** (mặc định) · **Dự đoán (bộ Test)** – toàn bộ 3.000 chuyến của bộ Test, bấm một chuyến để mô hình
  dự đoán và xem trên bản đồ, hoặc dự đoán cả bộ, so với file CSV đã nộp (lệch < 5% là app dùng mô hình thật) và tải CSV ·
  **Nhập thủ công** – điểm đi / điểm đến mỗi điểm chọn *Nhập vị trí* hoặc *Nhập tọa độ* · **Lịch sử** (lưu
  `data/history.json`). Mở thẳng một tab bằng `#chat`, `#predict`, `#form`, `#history` trên URL.

- **Song ngữ Việt / Anh** (nút `VI | EN` trên thanh trên): toàn bộ giao diện, các bước công cụ và câu trả lời của LLM
  đổi theo ngôn ngữ đã chọn. **Giao diện sáng / tối** (nút mặt trời / mặt trăng): mặc định theo hệ điều hành. Cả hai
  lựa chọn được nhớ trong trình duyệt.

## Kiến trúc

```
Trình duyệt (React + Vite, Google Maps)
   │  /api/*  (SSE cho chat)
   ▼
Node Express  server/  ── LLM orchestrator (OpenAI tool calling)
   │                    ├─ Google Geocoding / Distance Matrix (tùy chọn) | Nominatim
   ▼
Python FastAPI  model_service/  ── LightGBM + CatBoost, tính đặc trưng, OSRM
```

Mô hình học trên 11 đặc trưng: `straight_line_km_approx`, 4 tọa độ (làm tròn 0,01°), giờ, mốc phút, thứ (0 = Thứ Hai),
tháng, `road_km_osrm`, `road_min_osrm`. Để dự đoán khớp lúc huấn luyện, `road_*_osrm` được tính **theo cặp ô 0,01°**:
tra bảng dựng từ bộ Train (`model_service/data/osrm_lookup.parquet`, 31.763 cặp ô), cặp chưa có thì gọi OSRM giữa tâm
hai ô – giống script `osrm_train.py` của BTC. Quãng đường Google Maps được hiển thị để đối chiếu (mô hình không học
trên số liệu Google nên không đưa trực tiếp vào mô hình).

## Chạy

Yêu cầu: Node 18+, Python 3.10+ (đã có `pip`).

```bash
cd web-app
npm run setup        # npm install + pip install -r model_service/requirements.txt
npm run dev          # model (8000) + API (8787) + web (5173)
```

Mở http://localhost:5173. Bản chạy một cổng: `npm start` (build rồi phục vụ ở http://localhost:8787).

Cấu hình (`web-app/.env`, xem `.env.example`; server cũng đọc `../.env` – nơi đã có `OPENAI_API_KEY`):

| Biến | Ý nghĩa |
|---|---|
| `OPENAI_API_KEY` | Bắt buộc cho chatbot |
| `OPENAI_MODEL` | LLM điều phối, mặc định `gpt-5.4-mini` |
| `GOOGLE_MAPS_API_KEY` | Tùy chọn – bật Geocoding + Distance Matrix (quãng đường, thời gian theo giao thông của Google) |
| `MODEL_DIR` | Thư mục model, mặc định `../final_model` |

Dựng lại bảng tra OSRM (khi đổi bộ Train):

```bash
npm run build:lookup -- "<đường dẫn>/UNETI2026_TRAIN_CHUNG_1200000_OSRM.csv"
```

Bộ Test dùng cho tab kiểm chứng đặt ở `model_service/data/*_TEST_3000.csv`; file `final_model/submission*.csv` khớp
trip_id sẽ được dùng để so sánh.
