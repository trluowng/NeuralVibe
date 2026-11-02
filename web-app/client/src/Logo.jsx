import React, { useId } from 'react';

// Logo: tuyến đường thực tế (vàng) và đường chim bay (nét đứt) giữa điểm đi và ghim điểm đến
export default function Logo({ size = 48, className = '' }) {
  const id = useId();
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#262a35" />
          <stop offset="1" stopColor="#0c0e13" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${id}bg)`} />
      <path d="M12 36 L35 24" stroke="#fff" strokeOpacity=".45" strokeWidth="2" strokeDasharray="2.4 3.4" strokeLinecap="round" />
      <path d="M12 36c8 0 6-9.5 13-9s8.5 1 10-3" fill="none" stroke="#ffc21a" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="12" cy="36" r="3.6" fill="#0c0e13" stroke="#ffc21a" strokeWidth="2.6" />
      <path d="M35 6.5a7 7 0 0 1 7 7c0 5.2-7 11.5-7 11.5s-7-6.3-7-11.5a7 7 0 0 1 7-7z" fill="#ffc21a" />
      <circle cx="35" cy="13.5" r="2.6" fill="#0c0e13" />
    </svg>
  );
}
