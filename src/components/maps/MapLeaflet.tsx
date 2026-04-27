import { useEffect, useRef } from "react";

type Props = {
  lat: number;
  lng: number;
  popupText: string;
  className?: string;
};

/** Só corre no browser — Leaflet importado dinamicamente (evita `window is not defined` no SSR). */
export function MapLeaflet({ lat, lng, popupText, className = "" }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    if (!elRef.current) return;

    let cancelled = false;
    void (async () => {
      await import("leaflet/dist/leaflet.css");
      const L = await import("leaflet");
      if (cancelled || !elRef.current) return;

      const map = L.map(elRef.current).setView([lat, lng], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          "&copy; <a href='https://www.openstreetmap.org/copyright' rel='noreferrer'>OpenStreetMap</a>",
      }).addTo(map);

      const icon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      });
      L.marker([lat, lng], { icon }).addTo(map).bindPopup(popupText);
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [lat, lng, popupText]);

  return (
    <div
      ref={elRef}
      className={`z-0 min-h-[16rem] w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner sm:min-h-[18rem] ${className}`}
    />
  );
}
