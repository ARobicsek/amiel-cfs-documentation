import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Wrapper component providing fullscreen capability for charts.
 *
 * Props:
 *   title: string - Chart section title
 *   children: React children (the chart component)
 */
export default function FullscreenChart({ title, children }) {
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        // Enter fullscreen
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else {
          // No API support, fallback immediately
          setIsFullscreen(true);
          return;
        }

        // Try landscape lock (Android only)
        try {
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
          }
        } catch (e) {
          console.warn('Landscape lock not supported or failed:', e);
        }
      } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.error('Fullscreen toggle error:', err);
      // Fallback to CSS fullscreen if API fails (e.g. permission denied)
      setIsFullscreen(prev => !prev);
    }
  }, []);

  useEffect(() => {
    const onFSChange = () => {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(isFull);
      if (!isFull) {
        try {
          screen.orientation?.unlock?.();
        } catch {
          // ignore
        }
      }
    };

    document.addEventListener('fullscreenchange', onFSChange);
    document.addEventListener('webkitfullscreenchange', onFSChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange);
      document.removeEventListener('webkitfullscreenchange', onFSChange);
    };
  }, []);

  const exitFallback = () => setIsFullscreen(false);

  // Check if Fullscreen API is available
  const fsSupported = typeof document !== 'undefined' &&
    (document.fullscreenEnabled || document.webkitFullscreenEnabled);

  return (
    <div
      ref={containerRef}
      className={`fullscreen-chart-container ${isFullscreen ? 'is-fullscreen' : ''}`}
    >
      {title && (
        <div className="chart-section-header">
          <span className="chart-section-title">{title}</span>
          {(fsSupported || !isFullscreen) && (
            <button
              className="fullscreen-btn"
              onClick={isFullscreen && !fsSupported ? exitFallback : toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '\u2715' : '\u26F6'}
            </button>
          )}
        </div>
      )}
      <div className="chart-content">
        {children}
      </div>
      {isFullscreen && !fsSupported && (
        <button className="fullscreen-close-btn" onClick={exitFallback}>
          Close
        </button>
      )}
    </div>
  );
}
