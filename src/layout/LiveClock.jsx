import { useEffect, useState } from 'react';
import { useSettings } from '../context/SettingsContext';

export default function LiveClock() {
  const { settings } = useSettings();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = new Intl.DateTimeFormat(settings.language, { timeStyle: 'medium' }).format(now);
  const date = new Intl.DateTimeFormat(settings.language, { dateStyle: 'medium' }).format(now);

  return (
    <>
      <span className="header__clock">{time}</span>
      <span className="header__sep" aria-hidden="true">
        |
      </span>
      <span className="header__date">{date}</span>
    </>
  );
}
