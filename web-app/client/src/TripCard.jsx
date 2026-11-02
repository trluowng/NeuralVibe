import React from 'react';
import { useI18n } from './i18n.jsx';

const coord = (v) => Number(v).toFixed(5);

// Thẻ trả lời trong chat: 1) tọa độ  2) khoảng cách chim bay & đường thực tế  3) kết quả dự đoán của mô hình
export default function TripCard({ trip }) {
  const { t, tr, weekdays, fmtDuration } = useI18n();
  const r = trip.route;
  const f = trip.features;
  const pickup = r?.pickup || { lat: trip.input.pickup_lat, lon: trip.input.pickup_lon };
  const dropoff = r?.dropoff || { lat: trip.input.dropoff_lat, lon: trip.input.dropoff_lon };
  const roadOsrm = r?.road_osrm?.km ?? f.road_km_osrm;
  const straight = r?.straight_line_km ?? f.straight_line_km_approx;

  return (
    <div className="trip-card">
      <section>
        <h5><span>1</span>{t('coords')}</h5>
        {[['g', pickup, t('pickup')], ['r', dropoff, t('dropoff')]].map(([c, pt, name]) => (
          <div key={c} className="coord-row">
            <i className={c} />
            <div>
              <b>{pt.label || name}</b>
              <small>{t('lat')} {coord(pt.lat)} · {t('lon')} {coord(pt.lon)}</small>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h5><span>2</span>{t('distance')}</h5>
        <div className="dist-grid">
          <div><small>{t('straight')}</small><b>{Number(straight).toFixed(2)} km</b></div>
          <div><small>{t('roadOsrm')}</small><b>{Number(roadOsrm).toFixed(2)} km</b></div>
          {r?.road_google?.km && <div><small>{t('roadGoogle')}</small><b>{r.road_google.km.toFixed(2)} km</b></div>}
          {straight > 0 && <div><small>{t('detour')}</small><b>{(roadOsrm / straight).toFixed(2)}×</b></div>}
        </div>
      </section>

      <section className="final">
        <h5><span>3</span>{t('result')}</h5>
        <div className="final-row">
          <div>
            <div className="final-min">{(trip.trip_duration_sec / 60).toFixed(1)} <small>{t('min')}</small></div>
            <small>{fmtDuration(trip.trip_duration_sec)} · {Math.round(trip.trip_duration_sec)} {t('sec')}</small>
          </div>
          <div className="final-meta">
            <span>{weekdays[f.pickup_dayofweek]}, {String(f.pickup_hour).padStart(2, '0')}:{String(f.pickup_minute_bucket).padStart(2, '0')} · {t('monthN', { n: f.pickup_month })}</span>
            <span>{t('lgbm')}</span>
          </div>
        </div>
      </section>
      {trip.warnings?.map((w) => <div key={w} className="warning">⚠️ {tr(w)}</div>)}
    </div>
  );
}
