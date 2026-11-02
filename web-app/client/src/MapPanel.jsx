import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import Icon from './Icon.jsx';
import { useI18n } from './i18n.jsx';

// Bản đồ Google Maps chỉ vẽ 2 đường: đường thực tế (tuyến OSRM do backend tính) và đường chim bay. Không hiện thời gian.
// Có GOOGLE_MAPS_API_KEY -> Google Maps JavaScript API chính thức; chưa có -> nền bản đồ Google qua Leaflet.
const NYC = { lat: 40.75, lng: -73.97 };
const ROAD = '#1a73e8';
const STRAIGHT = '#ea4335';

const roadPath = (route) => (route.geometry || []).map(([lon, lat]) => ({ lat, lng: lon }));
const straightPath = (route) => [
  { lat: route.pickup.lat, lng: route.pickup.lon },
  { lat: route.dropoff.lat, lng: route.dropoff.lon },
];

let googleLoader;
// Maps JavaScript API chỉ nạp được một lần: ngôn ngữ bản đồ theo ngôn ngữ lúc mở trang
function loadGoogleMaps(key, lang) {
  googleLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=${lang}&region=US`;
    s.async = true;
    s.onload = () => resolve(window.google.maps);
    s.onerror = () => reject(new Error('Không tải được Google Maps JavaScript API'));
    document.head.appendChild(s);
  });
  return googleLoader;
}

function GoogleJsMap({ apiKey, route }) {
  const { lang, t } = useI18n();
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef([]);
  const [error, setError] = useState('');

  useEffect(() => {
    loadGoogleMaps(apiKey, lang).then((gm) => {
      map.current ??= new gm.Map(el.current, {
        center: NYC, zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
      });
      layers.current.forEach((l) => l.setMap(null));
      layers.current = [];
      if (!route) return;
      const add = (l) => layers.current.push(l);
      const road = roadPath(route);
      if (road.length) add(new gm.Polyline({ map: map.current, path: road, strokeColor: ROAD, strokeWeight: 5, strokeOpacity: 0.9 }));
      add(new gm.Polyline({
        map: map.current, path: straightPath(route), strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: STRAIGHT, strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '14px' }],
      }));
      add(new gm.Marker({ map: map.current, position: straightPath(route)[0], label: 'A', title: route.pickup.label || t('pickup') }));
      add(new gm.Marker({ map: map.current, position: straightPath(route)[1], label: 'B', title: route.dropoff.label || t('dropoff') }));
      const bounds = new gm.LatLngBounds();
      [...road, ...straightPath(route)].forEach((p) => bounds.extend(p));
      map.current.fitBounds(bounds, 40);
    }).catch((e) => setError(e.message));
  }, [apiKey, route]);

  return error ? <div className="map-error">⚠️ {error}</div> : <div ref={el} className="gmap" />;
}

function FitBounds({ route }) {
  const map = useMap();
  useEffect(() => {
    if (route) map.fitBounds([...roadPath(route), ...straightPath(route)].map((p) => [p.lat, p.lng]), { padding: [36, 36] });
  }, [route, map]);
  return null;
}

function GoogleTileMap({ route }) {
  const { lang, t } = useI18n();
  const ll = (pts) => pts.map((p) => [p.lat, p.lng]);
  return (
    <MapContainer center={[NYC.lat, NYC.lng]} zoom={11} scrollWheelZoom className="gmap">
      <TileLayer
        key={lang}
        attribution={t('mapAttr')}
        url={`https://{s}.google.com/vt/lyrs=m&hl=${lang}&x={x}&y={y}&z={z}`}
        subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
        maxZoom={20}
      />
      {route && (
        <>
          <FitBounds route={route} />
          {route.geometry && <Polyline positions={ll(roadPath(route))} pathOptions={{ color: ROAD, weight: 5, opacity: 0.9 }} />}
          <Polyline positions={ll(straightPath(route))} pathOptions={{ color: STRAIGHT, weight: 3, dashArray: '8 8' }} />
          {straightPath(route).map((p, i) => (
            <CircleMarker key={i} center={[p.lat, p.lng]} radius={9}
              pathOptions={{ color: '#fff', weight: 3, fillOpacity: 1, fillColor: i ? STRAIGHT : '#188038' }}>
              <Tooltip>{i ? `${t('dropoff')}: ${route.dropoff.label || ''}` : `${t('pickup')}: ${route.pickup.label || ''}`}</Tooltip>
            </CircleMarker>
          ))}
        </>
      )}
    </MapContainer>
  );
}

export default function MapPanel({ route, apiKey }) {
  const { t } = useI18n();
  const road = route?.road_osrm?.km;
  return (
    <div className="card map-card">
      <div className="map-head">
        <h3><Icon name="map" size={17} />{t('mapTitle')}</h3>
        {route && (
          <a className="gmaps-link" href={route.google_maps.directions} target="_blank" rel="noreferrer">
            {t('openGmaps')} <Icon name="external" size={14} />
          </a>
        )}
      </div>
      <div className="map-body">
        {apiKey ? <GoogleJsMap apiKey={apiKey} route={route} /> : <GoogleTileMap route={route} />}
      </div>
      <div className="legend">
        <span><i className="g" />{t('pickup')}</span>
        <span><i className="r" />{t('dropoff')}</span>
        <span><i className="line" />{t('roadLine')}{road ? ` · ${road.toFixed(2)} km` : ''}</span>
        <span><i className="dash" />{t('straightLine')}{route ? ` · ${route.straight_line_km.toFixed(2)} km` : ''}</span>
      </div>
    </div>
  );
}
