import { useRef, useEffect } from 'react';

/**
 * Activity broken bar showing ASLEEP / WALKING / BLANK segments across 24 hours.
 * Rendered as a Canvas for performance with 1440 minute slots.
 *
 * Props:
 *   activityMinutes: Array(1440) of 'ASLEEP' | 'WALKING' | 'BLANK'
 *   isDark: boolean
 */
export default function ActivityBar({ activityMinutes = [], isDark }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activityMinutes.length === 0) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Colors
    const colors = {
      ASLEEP: isDark ? '#6B8DB5' : '#93B5D5',
      WALKING: isDark ? '#7BC67E' : '#6ABF6E',
      BLANK: isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.03)',
    };

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw each minute as a thin vertical bar
    const barHeight = height;
    const minuteWidth = width / 1440;

    for (let m = 0; m < 1440; m++) {
      const state = activityMinutes[m] || 'BLANK';
      ctx.fillStyle = colors[state];
      ctx.fillRect(m * minuteWidth, 0, Math.ceil(minuteWidth), barHeight);
    }

    // Draw time markers
    ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.3)' : 'rgba(0, 0, 0, 0.15)';
    const markers = [0, 240, 480, 720, 960, 1200, 1440];
    markers.forEach(m => {
      const x = (m / 1440) * width;
      ctx.fillRect(x, 0, 1, barHeight);
    });
  }, [activityMinutes, isDark]);

  if (activityMinutes.length === 0) {
    return <div className="stats-no-data">No activity data</div>;
  }

  return (
    <div className="activity-bar-wrapper">
      <canvas
        ref={canvasRef}
        className="activity-bar-canvas"
        style={{ width: '100%', height: '50px' }}
      />
      <div className="activity-bar-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: isDark ? '#6B8DB5' : '#93B5D5' }} />
          Sleep
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: isDark ? '#7BC67E' : '#6ABF6E' }} />
          Walking
        </span>
      </div>
    </div>
  );
}
