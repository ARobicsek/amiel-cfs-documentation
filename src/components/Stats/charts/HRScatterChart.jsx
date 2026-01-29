import { useRef } from 'react';
import { Scatter } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  Tooltip,
  TimeScale,
} from 'chart.js';
import { formatTime } from '../../../utils/statsDataService';

ChartJS.register(LinearScale, PointElement, Tooltip, TimeScale);

/**
 * 24-hour HR scatter plot.
 * Each point is a single HR reading at its minute-of-day.
 *
 * Props:
 *   hrPoints: Array<{ minuteOfDay: number, bpm: number }>
 *   isDark: boolean
 */
export default function HRScatterChart({ hrPoints = [], isDark }) {
  const chartRef = useRef(null);

  if (hrPoints.length === 0) {
    return <div className="stats-no-data">No heart rate data</div>;
  }

  const data = {
    datasets: [
      {
        label: 'Heart Rate',
        data: hrPoints.map(p => ({ x: p.minuteOfDay, y: p.bpm })),
        backgroundColor: isDark ? 'rgba(255, 107, 107, 0.7)' : 'rgba(239, 68, 68, 0.6)',
        pointRadius: 2.5,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#FF6B6B',
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'nearest',
      intersect: true,
    },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: 1440,
        ticks: {
          callback: (value) => {
            const h = Math.floor(value / 60);
            if (h === 0) return '12AM';
            if (h === 4) return '4AM';
            if (h === 8) return '8AM';
            if (h === 12) return '12PM';
            if (h === 16) return '4PM';
            if (h === 20) return '8PM';
            return '';
          },
          color: isDark ? '#94a3b8' : '#64748b',
          maxTicksLimit: 7,
        },
        grid: {
          color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)',
        },
        title: { display: false },
      },
      y: {
        ticks: {
          color: isDark ? '#94a3b8' : '#64748b',
          callback: (value) => `${value}`,
        },
        grid: {
          color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)',
        },
        title: {
          display: true,
          text: 'BPM',
          color: isDark ? '#94a3b8' : '#64748b',
          font: { size: 11 },
        },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => {
            if (items.length === 0) return '';
            return formatTime(items[0].raw.x);
          },
          label: (item) => `${item.raw.y} BPM`,
        },
        backgroundColor: isDark ? '#1e293b' : '#ffffff',
        titleColor: isDark ? '#f8fafc' : '#0f172a',
        bodyColor: isDark ? '#f8fafc' : '#0f172a',
        borderColor: isDark ? '#334155' : '#e2e8f0',
        borderWidth: 1,
      },
      legend: { display: false },
    },
  };

  return (
    <div className="stats-chart-container" style={{ height: '250px' }}>
      <Scatter ref={chartRef} data={data} options={options} />
    </div>
  );
}
