"""Dịch vụ dự đoán thời gian chuyến taxi NYC (FastAPI).

Mô hình chính: LightGBM final (RMSLE kiểm định 0,3385 - thấp nhất trong các mô hình đã thử).
CatBoost được tải kèm để hiển thị đối chiếu.

Đặc trưng được tính đúng như lúc huấn luyện:
  - tọa độ làm tròn 0,01 độ (ô ~1 km)
  - straight_line_km_approx: haversine, làm tròn 0,5 km (nếu đầu vào chưa có sẵn)
  - road_km_osrm / road_min_osrm: tra bảng ô -> ô dựng từ bộ Train; cặp ô chưa có thì gọi OSRM
    giữa tâm hai ô (cùng cách với script osrm_train.py của BTC)
Mô hình dự đoán log1p(trip_duration) -> expm1 -> giây.
"""
import glob
import math
import os
import time

import httpx
import joblib
import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

THU_MUC = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(THU_MUC, "..", "..", "final_model"))
DATA_DIR = os.path.join(THU_MUC, "data")
OSRM_URL = os.environ.get("OSRM_URL", "https://router.project-osrm.org").rstrip("/")

goi = joblib.load(os.path.join(MODEL_DIR, "lightgbm_final.pkl"))
LGBM = goi["model"]
FEATURES = goi["features"]
VAL_RMSLE = goi.get("validation_rmsle")

CATBOOST = None
duong_cb = os.path.join(MODEL_DIR, "catboost_final.cbm")
if os.path.exists(duong_cb):
    CATBOOST = CatBoostRegressor()
    CATBOOST.load_model(duong_cb)

_bang = pd.read_parquet(os.path.join(DATA_DIR, "osrm_lookup.parquet"))
LOOKUP = {(r.lon1, r.lat1, r.lon2, r.lat2): (float(r.road_km_osrm), float(r.road_min_osrm))
          for r in _bang.itertuples(index=False)}
LON_MIN, LON_MAX = _bang[["lon1", "lon2"]].min().min() / 100, _bang[["lon1", "lon2"]].max().max() / 100
LAT_MIN, LAT_MAX = _bang[["lat1", "lat2"]].min().min() / 100, _bang[["lat1", "lat2"]].max().max() / 100
del _bang

THU = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"]

http = httpx.Client(timeout=30, headers={"User-Agent": "UNETI-Olympic-AI-2026-taxi-app"})
_cache_osrm = {}


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def o(x):
    return int(round(x * 100))


def osrm_route(lon1, lat1, lon2, lat2, hinh_hoc=False):
    tham_so = {"overview": "full" if hinh_hoc else "false", "geometries": "geojson"}
    r = http.get("%s/route/v1/driving/%.6f,%.6f;%.6f,%.6f" % (OSRM_URL, lon1, lat1, lon2, lat2), params=tham_so)
    j = r.json()
    if r.status_code != 200 or j.get("code") != "Ok":
        raise RuntimeError("OSRM lỗi: %s" % j.get("message", r.status_code))
    return j["routes"][0]


def dac_trung_osrm(lat1, lon1, lat2, lon2):
    """road_km_osrm, road_min_osrm theo cặp ô 0,01 độ - giống hệt cách tính trong bộ Train."""
    khoa = (o(lon1), o(lat1), o(lon2), o(lat2))
    if khoa[:2] == khoa[2:]:
        return 0.0, 0.0, "cùng ô"
    if khoa in LOOKUP:
        km, phut = LOOKUP[khoa]
        return km, phut, "bảng tra Train"
    if khoa in _cache_osrm:
        return (*_cache_osrm[khoa], "OSRM trực tiếp")
    route = osrm_route(khoa[0] / 100, khoa[1] / 100, khoa[2] / 100, khoa[3] / 100)
    gia_tri = (round(route["distance"] / 1000, 3), round(route["duration"] / 60, 2))
    _cache_osrm[khoa] = gia_tri
    return (*gia_tri, "OSRM trực tiếp")


class Diem(BaseModel):
    lat: float
    lon: float


class YeuCauRoute(BaseModel):
    pickup: Diem
    dropoff: Diem


class YeuCauDuDoan(BaseModel):
    pickup_lat: float
    pickup_lon: float
    dropoff_lat: float
    dropoff_lon: float
    pickup_month: int = Field(ge=1, le=12)
    pickup_dayofweek: int = Field(ge=0, le=6, description="0 = Thứ Hai ... 6 = Chủ nhật")
    pickup_hour: int = Field(ge=0, le=23)
    pickup_minute: int = Field(0, ge=0, le=59, description="Phút đón; được đưa về mốc 0/15/30/45")
    straight_line_km_approx: float | None = None
    road_km_osrm: float | None = None
    road_min_osrm: float | None = None


app = FastAPI(title="UNETI Taxi Duration Model")


@app.get("/health")
def health():
    return {"ok": True, "model": "LightGBM final", "features": FEATURES, "validation_rmsle": VAL_RMSLE,
            "n_estimators": LGBM.n_estimators, "num_leaves": LGBM.num_leaves,
            "catboost": CATBOOST is not None, "osrm_pairs": len(LOOKUP),
            "bounds": {"lon": [LON_MIN, LON_MAX], "lat": [LAT_MIN, LAT_MAX]}}


@app.post("/route")
def route(y: YeuCauRoute):
    """Khoảng cách chim bay + quãng đường đường phố (OSRM) cho 2 điểm, kèm đường đi để vẽ bản đồ."""
    p, d = y.pickup, y.dropoff
    chim_bay = haversine_km(p.lat, p.lon, d.lat, d.lon)
    ket_qua = {"straight_line_km": round(chim_bay, 3), "straight_line_km_approx": round(chim_bay * 2) / 2}
    try:
        r = osrm_route(p.lon, p.lat, d.lon, d.lat, hinh_hoc=True)
        ket_qua["osrm_exact"] = {"km": round(r["distance"] / 1000, 3), "min": round(r["duration"] / 60, 2),
                                 "geometry": r["geometry"]["coordinates"]}
    except Exception as e:  # bản đồ vẫn hiện được kể cả khi OSRM lỗi
        ket_qua["osrm_exact"] = None
        ket_qua["osrm_error"] = str(e)
    try:
        km, phut, nguon = dac_trung_osrm(p.lat, p.lon, d.lat, d.lon)
        ket_qua["model_road"] = {"road_km_osrm": km, "road_min_osrm": phut, "source": nguon}
    except Exception as e:
        ket_qua["model_road"] = None
        ket_qua["model_road_error"] = str(e)
    ket_qua["in_nyc"] = all(LON_MIN <= x.lon <= LON_MAX and LAT_MIN <= x.lat <= LAT_MAX for x in (p, d))
    return ket_qua


@app.post("/predict")
def predict(y: YeuCauDuDoan):
    t0 = time.perf_counter()
    plat, plon, dlat, dlon = (round(v, 2) for v in (y.pickup_lat, y.pickup_lon, y.dropoff_lat, y.dropoff_lon))
    if y.straight_line_km_approx is None:
        chim_bay = round(haversine_km(y.pickup_lat, y.pickup_lon, y.dropoff_lat, y.dropoff_lon) * 2) / 2
        nguon_cb = "haversine (làm tròn 0,5 km)"
    else:
        chim_bay, nguon_cb = y.straight_line_km_approx, "đầu vào"
    if y.road_km_osrm is None or y.road_min_osrm is None:
        try:
            road_km, road_min, nguon_road = dac_trung_osrm(y.pickup_lat, y.pickup_lon, y.dropoff_lat, y.dropoff_lon)
        except Exception as e:
            raise HTTPException(502, "Không lấy được quãng đường OSRM: %s" % e)
    else:
        road_km, road_min, nguon_road = y.road_km_osrm, y.road_min_osrm, "đầu vào"

    hang = {"straight_line_km_approx": chim_bay, "pickup_lon_approx": plon, "pickup_lat_approx": plat,
            "dropoff_lon_approx": dlon, "dropoff_lat_approx": dlat, "pickup_hour": y.pickup_hour,
            "pickup_minute_bucket": (y.pickup_minute // 15) * 15, "pickup_dayofweek": y.pickup_dayofweek,
            "pickup_month": y.pickup_month, "road_km_osrm": road_km, "road_min_osrm": road_min}
    X = pd.DataFrame([hang])[FEATURES]
    giay = float(np.expm1(LGBM.predict(X)[0]))
    giay_cb = float(np.expm1(CATBOOST.predict(X)[0])) if CATBOOST is not None else None

    canh_bao = []
    if not all(LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX for lon, lat in ((plon, plat), (dlon, dlat))):
        canh_bao.append("Tọa độ nằm ngoài vùng New York của dữ liệu huấn luyện - kết quả không đáng tin.")

    return {"trip_duration_sec": giay, "trip_duration_min": giay / 60,
            "catboost_sec": giay_cb, "features": hang,
            "sources": {"straight_line": nguon_cb, "road": nguon_road},
            "weekday_name": THU[y.pickup_dayofweek], "model": "LightGBM final",
            "validation_rmsle": VAL_RMSLE, "warnings": canh_bao,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}


def _bo_test():
    ra = {}
    for f in sorted(glob.glob(os.path.join(DATA_DIR, "*_TEST_3000.csv"))):
        ra[os.path.basename(f).split("_")[0]] = f
    return ra


def _file_nop():
    """Các file submission*.csv của đội (để đối chiếu giá trị đã nộp với dự đoán của app)."""
    ra = {}
    for f in sorted(glob.glob(os.path.join(MODEL_DIR, "submission*.csv"))):
        ra[os.path.basename(f)] = pd.read_csv(f).set_index("trip_id")["trip_duration"]
    return ra


BO_TEST = _bo_test()
FILE_NOP = _file_nop()


@app.get("/test-sets")
def test_sets():
    ds = []
    for ten, f in BO_TEST.items():
        ids = set(pd.read_csv(f, usecols=["trip_id"]).trip_id)
        khop = [n for n, s in FILE_NOP.items() if ids <= set(s.index)]
        ds.append({"name": ten, "rows": len(ids), "submissions": khop})
    return ds


def _doc_test(ten):
    if ten not in BO_TEST:
        raise HTTPException(404, "Không có bộ test %s" % ten)
    return pd.read_csv(BO_TEST[ten])


@app.get("/test-sets/{ten}/rows")
def test_rows(ten: str):
    """Toàn bộ chuyến của bộ Test, kèm giá trị trong submission.csv (nếu khớp) để đối chiếu."""
    df = _doc_test(ten)
    s = FILE_NOP.get("submission.csv")
    df["submitted_sec"] = df.trip_id.map(s) if s is not None else np.nan
    return df.replace({np.nan: None}).to_dict("records")


@app.post("/test-sets/{ten}/predict")
def test_predict(ten: str):
    """Chạy mô hình trên cả bộ Test (đặc trưng tính như /predict), trả về dự đoán từng trip_id."""
    t0 = time.perf_counter()
    df = _doc_test(ten)
    road = []
    for r in df.itertuples(index=False):
        try:
            road.append(dac_trung_osrm(r.pickup_lat_approx, r.pickup_lon_approx, r.dropoff_lat_approx, r.dropoff_lon_approx)[:2])
        except Exception as e:
            raise HTTPException(502, "Không lấy được quãng đường OSRM cho %s: %s" % (r.trip_id, e))
    df["road_km_osrm"], df["road_min_osrm"] = zip(*road)
    giay = np.expm1(LGBM.predict(df[FEATURES]))
    return {"model": "LightGBM final", "seconds": round(time.perf_counter() - t0, 2),
            "predictions": [{"trip_id": i, "app_sec": float(p), "road_km_osrm": k}
                            for i, p, k in zip(df.trip_id, giay, df.road_km_osrm)]}
