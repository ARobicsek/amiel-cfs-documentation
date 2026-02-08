import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { isNoWatchDay } from '../../../utils/noWatchDays';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/**
 * Sleep Stacked Bar Chart for Multi-Day view.
 * Shows deep/rem/core/awake sleep stages stacked per day, in hours.
 *
 * Props:
 *   days: Array<{ date, sleep: { total, deep, rem, core, awake } | null }>
 *   isDark: boolean
 *   isFullscreen: boolean
 */
export default function SleepStackedBar({ days = [], isDark, isFullscreen }) {
  const { labels, deepData, remData, coreData, awakeData, noWatchFlags } = useMemo(() => {
    const labels = [];
    const deepData = [];
    const remData = [];
    const coreData = [];
    const awakeData = [];
    const noWatchFlags = [];

    for (const day of days) {
      const [, m, d] = day.date.split('-');
      labels.push(`${parseInt(m)}/${parseInt(d)}`);
      noWatchFlags.push(isNoWatchDay(day.date));

      if (day.sleep) {
        // Convert minutes to hours for display
        deepData.push(day.sleep.deep != null ? +(day.sleep.deep / 60).toFixed(2) : 0);
        remData.push(day.sleep.rem != null ? +(day.sleep.rem / 60).toFixed(2) : 0);
        coreData.push(day.sleep.core != null ? +(day.sleep.core / 60).toFixed(2) : 0);
        awakeData.push(day.sleep.awake != null ? +(day.sleep.awake / 60).toFixed(2) : 0);
      } else {
        deepData.push(null);
        remData.push(null);
        coreData.push(null);
        awakeData.push(null);
      }
    }

    return { labels, deepData, remData, coreData, awakeData, noWatchFlags };
  }, [days]);

  // Per-bar colors: grey shades for no-watch days, normal colors otherwise
  const barColors = useMemo(() => {
    // Normal colors per stage
    const normal = {
      deep:  isDark ? 'rgba(59, 130, 246, 0.8)'  : 'rgba(37, 99, 235, 0.7)',
      rem:   isDark ? 'rgba(139, 92, 246, 0.8)'   : 'rgba(124, 58, 237, 0.7)',
      core:  isDark ? 'rgba(107, 141, 181, 0.7)'   : 'rgba(147, 181, 213, 0.7)',
      awake: isDark ? 'rgba(251, 191, 36, 0.6)'    : 'rgba(245, 158, 11, 0.5)',
    };
    // Grey shades for no-watch days (different opacities to preserve stacking visibility)
    const grey = {
      deep:  isDark ? 'rgba(107, 114, 128, 0.6)' : 'rgba(156, 163, 175, 0.5)',
      rem:   isDark ? 'rgba(107, 114, 128, 0.45)' : 'rgba(156, 163, 175, 0.38)',
      core:  isDark ? 'rgba(107, 114, 128, 0.3)' : 'rgba(156, 163, 175, 0.25)',
      awake: isDark ? 'rgba(107, 114, 128, 0.2)' : 'rgba(156, 163, 175, 0.15)',
    };

    return {
      deep:  noWatchFlags.map(nw => nw ? grey.deep : normal.deep),
      rem:   noWatchFlags.map(nw => nw ? grey.rem : normal.rem),
      core:  noWatchFlags.map(nw => nw ? grey.core : normal.core),
      awake: noWatchFlags.map(nw => nw ? grey.awake : normal.awake),
    };
  }, [isDark, noWatchFlags]);

  const data = useMemo(() => ({
    labels,
    datasets: [
      {
        label: 'Deep',
        data: deepData,
        backgroundColor: barColors.deep,
        borderWidth: 0,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
      {
        label: 'REM',
        data: remData,
        backgroundColor: barColors.rem,
        borderWidth: 0,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
      {
        label: 'Core',
        data: coreData,
        backgroundColor: barColors.core,
        borderWidth: 0,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
      {
        label: 'Awake',
        data: awakeData,
        backgroundColor: barColors.awake,
        borderWidth: 0,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
    ],
  }), [labels, deepData, remData, coreData, awakeData, barColors]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 10, bottom: 5, left: 5, right: 5 } },
    scales: {
      x: {
        stacked: true,
        ticks: {
          color: isDark ? '#94a3b8' : '#64748b',
          maxRotation: 45,
          autoSkip: true,
          maxTicksLimit: isFullscreen ? 30 : 15,
          font: { size: isFullscreen ? 12 : 10 },
        },
        grid: { display: false },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: {
          color: isDark ? '#94a3b8' : '#64748b',
          callback: (v) => `${v}h`,
        },
        grid: { color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)' },
        title: { display: true, text: 'Hours', color: isDark ? '#94a3b8' : '#64748b', font: { size: 11 } },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: isDark ? '#94a3b8' : '#64748b',
          boxWidth: 12,
          padding: 8,
          font: { size: 10 },
        },
      },
      tooltip: {
        callbacks: {
          title: (items) => {
            if (!items.length) return '';
            const idx = items[0].dataIndex;
            return days[idx]?.date || '';
          },
          label: (item) => {
            const hours = item.raw;
            if (hours == null) return '';
            const mins = Math.round(hours * 60);
            const h = Math.floor(mins / 60);
            const m = mins % 60;

            // Calculate percentage of actual sleep (excluding awake)
            const idx = item.dataIndex;
            const sleep = days[idx]?.sleep;
            let pct = '';
            if (sleep && mins > 0) {
              // Calculate sleep-only total (total already excludes awake from API)
              const sleepTotal = sleep.total || 0;
              if (sleepTotal > 0) {
                const percentage = Math.round((mins / sleepTotal) * 100);
                pct = ` (${percentage}%)`;
              }
            }
            return `${item.dataset.label}: ${h}h ${m}m${pct}`;
          },
          afterBody: (items) => {
            if (!items.length) return '';
            const idx = items[0].dataIndex;
            const sleep = days[idx]?.sleep;
            if (!sleep) return '';

            // Total sleep (excludes awake)
            const totalH = Math.floor(sleep.total / 60);
            const totalM = Math.round(sleep.total % 60);
            return `Total Sleep: ${totalH}h ${totalM}m`;
          },
        },
        backgroundColor: isDark ? '#1e293b' : '#ffffff',
        titleColor: isDark ? '#f8fafc' : '#0f172a',
        bodyColor: isDark ? '#f8fafc' : '#0f172a',
        footerColor: isDark ? '#94a3b8' : '#64748b',
        borderColor: isDark ? '#334155' : '#e2e8f0',
        borderWidth: 1,
      },
    },
  }), [isDark, isFullscreen, days]);

  if (days.length === 0 || days.every(d => !d.sleep)) {
    return <div className="stats-no-data">No sleep data available</div>;
  }

  return (
    <div className="stats-chart-container" style={{ height: isFullscreen ? '100%' : '250px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}
