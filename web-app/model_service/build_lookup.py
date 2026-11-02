"""Tạo bảng tra quãng đường OSRM theo cặp ô tọa độ (0,01 độ) từ bộ Train đã có cột OSRM.

Bảng này giúp ứng dụng tính road_km_osrm / road_min_osrm đúng như lúc huấn luyện mô hình
(cùng nguồn OSRM, cùng cách làm tròn ô). Cặp ô chưa có trong bảng sẽ được gọi OSRM trực tiếp.

Chạy:
  python build_lookup.py --train "<đường dẫn>/UNETI2026_TRAIN_CHUNG_1200000_OSRM.csv"
"""
import argparse
import os

import pandas as pd

THU_MUC = os.path.dirname(os.path.abspath(__file__))
COT_TOA_DO = ["pickup_lon_approx", "pickup_lat_approx", "dropoff_lon_approx", "dropoff_lat_approx"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True, help="File Train có cột road_km_osrm, road_min_osrm")
    ap.add_argument("--ra", default=os.path.join(THU_MUC, "data", "osrm_lookup.parquet"))
    args = ap.parse_args()

    tr = pd.read_csv(args.train, usecols=COT_TOA_DO + ["road_km_osrm", "road_min_osrm"])
    o = (tr[COT_TOA_DO] * 100).round().astype(int)
    o.columns = ["lon1", "lat1", "lon2", "lat2"]
    bang = pd.concat([o, tr[["road_km_osrm", "road_min_osrm"]]], axis=1)
    bang = bang.dropna().drop_duplicates(["lon1", "lat1", "lon2", "lat2"]).reset_index(drop=True)
    os.makedirs(os.path.dirname(args.ra), exist_ok=True)
    bang.to_parquet(args.ra, index=False)
    print("Đã ghi %s: %d cặp ô" % (args.ra, len(bang)))


if __name__ == "__main__":
    main()
