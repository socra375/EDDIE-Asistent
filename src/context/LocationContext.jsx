import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const LocationContext = createContext(null);

// Requests the browser's geolocation once on load (the user chose this
// flow explicitly over a manual city field) so Gemini's get_current_weather
// tool can default to "where the user actually is" without asking every
// time. If denied/unsupported, Eddie simply doesn't have it — it asks for
// a city instead, per the system prompt in personality.js.
export function LocationProvider({ children }) {
  const [location, setLocation] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | requesting | granted | denied | unsupported

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      return;
    }
    setStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setStatus('granted');
      },
      () => setStatus('denied'),
      { timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const value = useMemo(() => ({ location, status, requestLocation }), [location, status, requestLocation]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation debe usarse dentro de <LocationProvider>');
  return ctx;
}
