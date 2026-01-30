import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Wrapper component providing fullscreen capability for charts.
 * Supports render props pattern to pass state to children.
 *
 * Props:
 *   title: string - Chart section title
 *   children: React node OR function({ isFullscreen })
 *   onNext: function - Callback for next day (fullscreen nav)
 *   canNext: boolean - Whether next navigation is enabled
 *   date: string - Display date string
 */
export default function FullscreenChart({ title, children, onPrev, onNext, canNext = true, date }) {
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const touchStartX = useRef(null);

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
          setIsFullscreen(true);
          return;
        }

        try {
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
          }
        } catch (e) {
          // ignore
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

  const handleTouchStart = (e) => {
    if (!isFullscreen) return;
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (!isFullscreen || touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;

    // Swipe Threshold: 50px
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        // Swipe Left -> Next Day
        if (canNext && onNext) onNext();
      } else {
        // Swipe Right -> Prev Day
        if (onPrev) onPrev();
      }
    }
    touchStartX.current = null;
  };

  const exitFallback = () => setIsFullscreen(false);

  // Check if Fullscreen API is available
  const fsSupported = typeof document !== 'undefined' &&
    (document.fullscreenEnabled || document.webkitFullscreenEnabled);

  return (
    <div
      ref={containerRef}
      className={`fullscreen-chart-container ${isFullscreen ? 'is-fullscreen' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {title && (
        <div className="chart-section-header">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <span className="chart-section-title">{title}</span>
            {isFullscreen && date && (
              <span style={{ fontSize: '14px', color: '#94a3b8', marginTop: '4px' }}>{date}</span>
            )}
          </div>
          {!isFullscreen && (
            <button
              className="fullscreen-btn"
              onClick={toggleFullscreen}
              title="Fullscreen"
            >
              {'\u26F6'}
            </button>
          )}
        </div>
      )}

      {/* Close (X) button at top-right in fullscreen */}
      {isFullscreen && (
        <button
          className="fs-close-btn"
          onClick={fsSupported ? toggleFullscreen : exitFallback}
          title="Exit fullscreen"
        >
          &times;
        </button>
      )}

      {/* Navigation Overlay (only in fullscreen) */}
      {isFullscreen && (
        <>
          <button
            className="fs-nav-btn fs-nav-prev"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPrev && onPrev(); }}
            onTouchStart={(e) => e.stopPropagation()}
          >
            &#9664;
          </button>
          <button
            className="fs-nav-btn fs-nav-next"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNext && onNext(); }}
            onTouchStart={(e) => e.stopPropagation()}
            disabled={!canNext}
            style={{ opacity: !canNext ? 0.3 : 1 }}
          >
            &#9654;
          </button>
        </>
      )}

      <div className="chart-content">
        {typeof children === 'function'
          ? children({ isFullscreen })
          : children
        }
      </div>
    </div>
  );
}
