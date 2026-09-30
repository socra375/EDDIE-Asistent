// Line icons (24×24, stroke-based) so each module can carry its own color in
// the icon rail instead of relying on emoji, which render differently per OS.
const PATHS = {
  home: 'M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9L12 2.5Zm0 6.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4M14 5l-4 14',
  check: 'M4 5h16v14H4V5Zm4 7 3 3 5-6',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.4a7.3 7.3 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.3 7.3 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  calendar: 'M5 5h14v15H5V5Zm0 5h14M9 3v4m6-4v4',
  close: 'M6 6l12 12M18 6 6 18',
  plug: 'M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0V8Zm5 8v5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2',
  cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18Z',
  mail: 'M4 6h16v12H4V6Zm0 0 8 7 8-7',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  phone: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  monitor: 'M3 5h18v11H3V5Zm6 15h6m-3-4v4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5Zm13 4h3v8a2 2 0 0 1-4 0M7 9h7m-7 4h7m-7 4h4',
  memory: 'M5 6c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2Zm0 0v6c0 1.1 3.1 2 7 2s7-.9 7-2V6M5 12v6c0 1.1 3.1 2 7 2s7-.9 7-2v-6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm2.5-12.5c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2.1c1.7.4 2.8 1 2.8 2.3s-1.2 2.1-2.8 2.1c-1.2 0-2.2-.5-2.7-1.4M12 5.8v1.5m0 9.4v1.5',
  panelOpen: 'M4 4h16v16H4V4Zm5 0v16m3-8 3-3m-3 3 3 3',
  panelClose: 'M4 4h16v16H4V4Zm5 0v16m6-11-3 3 3 3',
};

export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
