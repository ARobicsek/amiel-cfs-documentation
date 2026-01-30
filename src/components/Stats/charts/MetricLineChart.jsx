import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

/**
 * Reusable line chart for Multi-Day metrics (Steps, HRV, Feet on Ground, Brain Time).
 *
 * Props:
 *   days: Array<{ date, [valueKey]: number | null }>
 *   valueKey: string - key to extract from each day object (e.g., 'steps', 'feetOnGround')
 *   valueExtractor: function(day) => number|null - alternative to valueKey for nested values
 *   label: string - dataset label
 *   unit: string - unit for Y axis (e.g., 'steps', 'ms', 'hours')
 *   color: string - line color hex (e.g., '#10b981')
 *   isDark: boolean
 *   isFullscreen: boolean
 *   formatValue: function(value) => string - optional formatter for tooltip
 *   tooltipExtra: function(day) => string|null - optional extra line for tooltip
 */
export default function MetricLineChart({
  days = [],
  valueKey,
  valueExtractor,
  label = 'Value',
  unit = '',
  color = '#10b981',
  isDark,
  isFullscreen,
  formatValue,
  tooltipExtra,
}) {
  const { labels, values } = useMemo(() => {
    const labels = [];
    const values = [];

    for (const day of days) {
      const [, m, d] = day.date.split('-');
      labels.push(`${parseInt(m)}/${parseInt(d)}`);

      let val = null;
      if (valueExtractor) {
        val = valueExtractor(day);
      } else if (valueKey) {
        val = day[valueKey];
      }
      values.push(val);
    }

    return { labels, values };
  }, [days, valueKey, valueExtractor]);

  const data = useMemo(() => ({
    labels,
    datasets: [{
      label,
      data: values,
      borderColor: color,
      backgroundColor: color + '33', // 20% opacity fill
      pointBackgroundColor: color,
      pointBorderColor: color,
      pointRadius: values.length > 60 ? 1 : (values.length > 30 ? 2 : 3),
      pointHoverRadius: 6,
      pointHitRadius: 15,
      borderWidth: 2,
      tension: 0.3,
      fill: true,
      spanGaps: false, // Gaps for missing days
    }],
  }), [labels, values, label, color]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 10, bottom: 5, left: 5, right: 5 } },
    scales: {
      x: {
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
        beginAtZero: true,
        ticks: {
          color: isDark ? '#94a3b8' : '#64748b',
          callback: unit ? (v) => `${v}${unit === 'hours' ? 'h' : ''}` : undefined,
        },
        grid: { color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)' },
        title: {
          display: true,
          text: unit.charAt(0).toUpperCase() + unit.slice(1),
          color: isDark ? '#94a3b8' : '#64748b',
          font: { size: 11 },
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => {
            if (!items.length) return '';
            const idx = items[0].dataIndex;
            return days[idx]?.date || '';
          },
          label: (item) => {
            const val = item.raw;
            if (val == null) return 'No data';
            if (formatValue) return `${label}: ${formatValue(val)}`;
            if (unit === 'hours') {
              const h = Math.floor(val);
              const m = Math.round((val - h) * 60);
              return `${label}: ${h}h ${m}m`;
            }
            return `${label}: ${typeof val === 'number' ? val.toLocaleString() : val} ${unit}`;
          },
          afterLabel: (item) => {
            if (!tooltipExtra) return '';
            const idx = item.dataIndex;
            const day = days[idx];
            if (!day) return '';
            return tooltipExtra(day) || '';
          },
        },
        backgroundColor: isDark ? '#1e293b' : '#ffffff',
        titleColor: isDark ? '#f8fafc' : '#0f172a',
        bodyColor: isDark ? '#f8fafc' : '#0f172a',
        borderColor: isDark ? '#334155' : '#e2e8f0',
        borderWidth: 1,
      },
    },
  }), [isDark, isFullscreen, days, label, unit, formatValue, tooltipExtra]);

  const hasData = values.some(v => v != null);
  if (days.length === 0 || !hasData) {
    return <div className="stats-no-data">No {label.toLowerCase()} data available</div>;
  }

  return (
    <div className="stats-chart-container" style={{ height: isFullscreen ? '100%' : '220px' }}>
      <Line data={data} options={options} />
    </div>
  );
}
