import { useEffect, useRef, useState } from 'react';
import Icon from '../layout/Icon';
import { PLAY_VIDEO_EVENT, PLAYER_CONTROL_EVENT } from '../services/browserActions';
import './YouTubePlayer.css';

const YT_ORIGIN = 'https://www.youtube-nocookie.com';

// The player Eddie uses when asked to play something ("ponme música de
// salsa"): YouTube's embedded player in a floating card, on any module, so no
// pop-up is needed. It is paused, resumed or closed by voice through
// `control_video` (events from browserActions) or with its own buttons. Some
// videos (music labels especially) refuse to play outside YouTube; the player
// says so (it listens to YouTube's error message) and offers the YouTube link.
export default function YouTubePlayer() {
  const [video, setVideo] = useState(null);
  const [refused, setRefused] = useState(false);
  const frameRef = useRef(null);

  useEffect(() => {
    const onPlay = (e) => {
      setRefused(false);
      setVideo({ ...e.detail, key: Date.now() });
    };
    const onControl = (e) => {
      const { action } = e.detail;
      if (action === 'close') {
        setVideo(null);
        return;
      }
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: action === 'pause' ? 'pauseVideo' : 'playVideo', args: [] }), YT_ORIGIN);
    };
    window.addEventListener(PLAY_VIDEO_EVENT, onPlay);
    window.addEventListener(PLAYER_CONTROL_EVENT, onControl);
    return () => {
      window.removeEventListener(PLAY_VIDEO_EVENT, onPlay);
      window.removeEventListener(PLAYER_CONTROL_EVENT, onControl);
    };
  }, []);

  // YouTube says so when a video can't be played in an embed (errors 101/150).
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== YT_ORIGIN || e.source !== frameRef.current?.contentWindow) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.event === 'onError') setRefused(true);
      } catch {
        /* not a player message */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!video) return null;
  const watch = `https://www.youtube.com/watch?v=${video.videoId}`;
  const src = `${YT_ORIGIN}/embed/${video.videoId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;

  return (
    <aside className="yt-player" aria-label="Reproductor de YouTube">
      <header className="yt-player__head">
        <Icon name="play" size={14} />
        <span className="yt-player__title" title={video.title}>
          {video.title || 'YouTube'}
          {video.channel && <span className="yt-player__channel"> · {video.channel}</span>}
        </span>
        <a className="btn yt-player__btn" href={watch} target="_blank" rel="noopener noreferrer" title="Abrir en YouTube">
          YouTube
        </a>
        <button type="button" className="btn yt-player__btn" onClick={() => setVideo(null)} aria-label="Cerrar el reproductor">
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="yt-player__frame">
        <iframe
          key={video.key}
          ref={frameRef}
          title={video.title || 'Video de YouTube'}
          src={src}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN)}
        />
        {refused && (
          <div className="yt-player__refused" role="alert">
            <p>Este video no se puede reproducir aquí.</p>
            <a className="btn btn-primary" href={watch} target="_blank" rel="noopener noreferrer">
              Abrir en YouTube
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
