import { useRef, useMemo } from 'react';
import { Scatter } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    LinearScale,
    PointElement,
    Tooltip,
    TimeScale,
    Title
} from 'chart.js';
import { formatTime } from '../../../utils/statsDataService';

ChartJS.register(LinearScale, PointElement, Tooltip, TimeScale, Title);

/**
 * Combined Chart: HR Scatter (Foreground) + Activity Bar (Background)
 *
 * Uses a custom plugin to draw the activity segments (Sleep/Walking) directly
 * on the canvas background before the datasets are drawn.
 *
 * Props:
 *   hrPoints: Array<{ minuteOfDay: number, bpm: number }>
 *   activityMinutes: Array(1440) of 'ASLEEP' | 'WALKING' | 'BLANK'
 *   isDark: boolean
 */
export default function CombinedChart({ hrPoints = [], activityMinutes = [], isDark }) {
    const chartRef = useRef(null);

    // Memoize data to prevent re-renders
    const data = useMemo(() => ({
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
    }), [hrPoints, isDark]);

    // Activity Background Plugin
    const activityPlugin = useMemo(() => ({
        id: 'activityBackground',
        beforeDraw: (chart) => {
            if (!activityMinutes || activityMinutes.length === 0) return;

            const { ctx, chartArea, scales } = chart;
            const { left, right, top, bottom, width, height } = chartArea;
            const xScale = scales.x;

            ctx.save();

            // Colors
            const colors = {
                ASLEEP: isDark ? 'rgba(107, 141, 181, 0.3)' : 'rgba(147, 181, 213, 0.3)', // Blueish
                WALKING: isDark ? 'rgba(123, 198, 126, 0.3)' : 'rgba(106, 191, 110, 0.3)', // Greenish
            };

            // Optimization: Group consecutive minutes with same state to reduce fillRect calls
            let startM = 0;
            let currentState = activityMinutes[0];

            const drawSegment = (start, end, state) => {
                if (state === 'BLANK' || !state) return;

                const x1 = xScale.getPixelForValue(start);
                const x2 = xScale.getPixelForValue(end + 1); // +1 to include the full minute width

                if (colors[state]) {
                    ctx.fillStyle = colors[state];
                    ctx.fillRect(x1, top, x2 - x1, height);
                }
            };

            for (let m = 1; m < 1440; m++) {
                const state = activityMinutes[m];
                if (state !== currentState) {
                    drawSegment(startM, m - 1, currentState);
                    currentState = state;
                    startM = m;
                }
            }
            // Draw last segment
            drawSegment(startM, 1439, currentState);

            ctx.restore();
        }
    }), [activityMinutes, isDark]);

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
                beginAtZero: false, // Let HR float
                // Suggest a reasonable range if data is sparse, but allow auto scaling
                suggestedMin: 50,
                suggestedMax: 120,
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

    if (hrPoints.length === 0 && activityMinutes.every(m => m === 'BLANK')) {
        return <div className="stats-no-data">No data for this day</div>;
    }

    return (
        <div className="stats-chart-container" style={{ height: '350px' }}>
            <Scatter
                ref={chartRef}
                data={data}
                options={options}
                plugins={[activityPlugin]}
            />
        </div>
    );
}
