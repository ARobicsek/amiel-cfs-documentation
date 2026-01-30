import { useMemo, useRef } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

/**
 * HR Box Plot Chart for Multi-Day view.
 * Draws box plots using a stacked bar chart + custom plugin for whiskers/median.
 *
 * Each "box" is two stacked bars: [q1→median] + [median→q3],
 * with whiskers drawn by a plugin from min→q1 and q3→max.
 *
 * Props:
 *   days: Array<{ date, hr: { min, q1, median, q3, max, count } | null }>
 *   isDark: boolean
 *   isFullscreen: boolean
 */
export default function HRBoxPlotChart({ days = [], isDark, isFullscreen }) {
  const daysRef = useRef(days);
  daysRef.current = days;

  const { labels, lowerBoxData, upperBoxData, rawData } = useMemo(() => {
    const labels = [];
    const lowerBoxData = [];
    const upperBoxData = [];
    const rawData = [];

    for (const day of days) {
      const [, m, d] = day.date.split('-');
      labels.push(`${parseInt(m)}/${parseInt(d)}`);

      if (day.hr) {
        // Lower box: q1 to median (bar starts at q1, height = median - q1)
        lowerBoxData.push([day.hr.q1, day.hr.median]);
        // Upper box: median to q3
        upperBoxData.push([day.hr.median, day.hr.q3]);
        rawData.push(day.hr);
      } else {
        lowerBoxData.push(null);
        upperBoxData.push(null);
        rawData.push(null);
      }
    }

    return { labels, lowerBoxData, upperBoxData, rawData };
  }, [days]);

  // Custom plugin to draw whiskers (lines from min→q1 and q3→max) and median line
  const whiskerPlugin = useMemo(() => ({
    id: 'boxplotWhiskers',
    afterDatasetsDraw: (chart) => {
      const data = daysRef.current;
      const { ctx, scales, chartArea } = chart;
      const xScale = scales.x;
      const yScale = scales.y;
      const dark = isDark;

      ctx.save();

      data.forEach((day, i) => {
        if (!day.hr) return;

        const x = xScale.getPixelForValue(i);
        const barWidth = (chartArea.width / data.length) * 0.5;

        // Whisker color
        ctx.strokeStyle = dark ? 'rgba(148, 163, 184, 0.7)' : 'rgba(100, 116, 139, 0.7)';
        ctx.lineWidth = 1.5;

        // Lower whisker: min to q1
        const yMin = yScale.getPixelForValue(day.hr.min);
        const yQ1 = yScale.getPixelForValue(day.hr.q1);
        ctx.beginPath();
        ctx.moveTo(x, yQ1);
        ctx.lineTo(x, yMin);
        ctx.stroke();
        // Min cap
        ctx.beginPath();
        ctx.moveTo(x - barWidth * 0.3, yMin);
        ctx.lineTo(x + barWidth * 0.3, yMin);
        ctx.stroke();

        // Upper whisker: q3 to max
        const yQ3 = yScale.getPixelForValue(day.hr.q3);
        const yMax = yScale.getPixelForValue(day.hr.max);
        ctx.beginPath();
        ctx.moveTo(x, yQ3);
        ctx.lineTo(x, yMax);
        ctx.stroke();
        // Max cap
        ctx.beginPath();
        ctx.moveTo(x - barWidth * 0.3, yMax);
        ctx.lineTo(x + barWidth * 0.3, yMax);
        ctx.stroke();

        // Median line (bold white/dark line across the box)
        const yMedian = yScale.getPixelForValue(day.hr.median);
        ctx.strokeStyle = dark ? '#f8fafc' : '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - barWidth * 0.5, yMedian);
        ctx.lineTo(x + barWidth * 0.5, yMedian);
        ctx.stroke();
      });

      ctx.restore();
    }
  }), [isDark]);

  const data = useMemo(() => ({
    labels,
    datasets: [
      {
        label: 'Q1→Median',
        data: lowerBoxData,
        backgroundColor: isDark ? 'rgba(74, 144, 217, 0.5)' : 'rgba(74, 144, 217, 0.4)',
        borderColor: isDark ? 'rgba(74, 144, 217, 0.8)' : 'rgba(74, 144, 217, 0.7)',
        borderWidth: 1,
        borderSkipped: false,
        barPercentage: 0.5,
        categoryPercentage: 0.8,
      },
      {
        label: 'Median→Q3',
        data: upperBoxData,
        backgroundColor: isDark ? 'rgba(74, 144, 217, 0.5)' : 'rgba(74, 144, 217, 0.4)',
        borderColor: isDark ? 'rgba(74, 144, 217, 0.8)' : 'rgba(74, 144, 217, 0.7)',
        borderWidth: 1,
        borderSkipped: false,
        barPercentage: 0.5,
        categoryPercentage: 0.8,
      },
    ],
  }), [labels, lowerBoxData, upperBoxData, isDark]);

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
        stacked: false,
        beginAtZero: false,
        suggestedMin: 40,
        suggestedMax: 130,
        ticks: { color: isDark ? '#94a3b8' : '#64748b' },
        grid: { color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)' },
        title: { display: true, text: 'BPM', color: isDark ? '#94a3b8' : '#64748b', font: { size: 11 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (item) => item.datasetIndex === 0, // Only show tooltip once per bar
        callbacks: {
          title: (items) => {
            if (!items.length) return '';
            const idx = items[0].dataIndex;
            return daysRef.current[idx]?.date || '';
          },
          label: (item) => {
            const idx = item.dataIndex;
            const d = rawData[idx];
            if (!d) return 'No data';
            return [
              `Max: ${d.max}`,
              `Q3: ${d.q3}`,
              `Median: ${d.median}`,
              `Q1: ${d.q1}`,
              `Min: ${d.min}`,
              `Samples: ${d.count}`,
            ];
          },
        },
        backgroundColor: isDark ? '#1e293b' : '#ffffff',
        titleColor: isDark ? '#f8fafc' : '#0f172a',
        bodyColor: isDark ? '#f8fafc' : '#0f172a',
        borderColor: isDark ? '#334155' : '#e2e8f0',
        borderWidth: 1,
      },
    },
  }), [isDark, isFullscreen, rawData]);

  if (days.length === 0 || days.every(d => !d.hr)) {
    return <div className="stats-no-data">No HR data available</div>;
  }

  return (
    <div className="stats-chart-container" style={{ height: isFullscreen ? '100%' : '250px' }}>
      <Bar data={data} options={options} plugins={[whiskerPlugin]} />
    </div>
  );
}
