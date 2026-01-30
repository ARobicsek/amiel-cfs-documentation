import { useRef, useMemo, useState } from 'react';
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
export default function CombinedChart({ hrPoints = [], activityMinutes = [], isDark, isFullscreen }) {
    const chartRef = useRef(null);
    const [tooltipState, setTooltipState] = useState({ visible: false, x: 0, y: 0, text: '' });

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

    // Min/Max Label Plugin (Only in Fullscreen)
    const minMaxPlugin = useMemo(() => ({
        id: 'minMaxLabels',
        afterDatasetsDraw: (chart) => {
            if (!isFullscreen || hrPoints.length === 0) return;

            const { ctx, scales } = chart;
            const xScale = scales.x;
            const yScale = scales.y;

            // Find Min and Max points
            let minPoint = hrPoints[0];
            let maxPoint = hrPoints[0];

            hrPoints.forEach(p => {
                if (p.bpm < minPoint.bpm) minPoint = p;
                if (p.bpm > maxPoint.bpm) maxPoint = p;
            });

            ctx.save();
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';

            const drawLabel = (point, label, isMax) => {
                const x = xScale.getPixelForValue(point.minuteOfDay);
                const y = yScale.getPixelForValue(point.bpm);

                // Colors
                ctx.fillStyle = isDark ? '#ffffff' : '#000000';
                ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 3;

                const text = `${label}: ${point.bpm}`;
                const textHeight = 12;
                let yOffset = isMax ? -10 : 20; // Max above, Min below

                // Collision detection
                if (isMax && (y + yOffset - textHeight) < scales.y.top) {
                    yOffset = 15;
                }
                if (!isMax && (y + yOffset) > scales.y.bottom) {
                    yOffset = -10;
                }

                ctx.strokeText(text, x, y + yOffset);
                ctx.fillText(text, x, y + yOffset);
            };

            // Draw labels
            drawLabel(maxPoint, 'Max', true);
            drawLabel(minPoint, 'Min', false);

            ctx.restore();
        }
    }), [hrPoints, isFullscreen, isDark]);

    const handleChartHover = (event, chartElement, chart) => {
        if (!activityMinutes || activityMinutes.length === 0) {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const { canvas, scales } = chart;
        const rect = canvas.getBoundingClientRect();

        // Use relative coordinates from the chart event
        const mouseX = event.x;
        const mouseY = event.y;

        // Check bounds
        if (mouseX < scales.x.left || mouseX > scales.x.right || mouseY < scales.y.top || mouseY > scales.y.bottom) {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const minute = Math.floor(scales.x.getValueForPixel(mouseX));

        // Ensure minute is within bounds
        if (minute < 0 || minute >= 1440) {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const state = activityMinutes[minute];

        if (state === 'ASLEEP') {
            // Found sleep! Calculate duration of this block
            let start = minute;
            while (start > 0 && activityMinutes[start - 1] === 'ASLEEP') {
                start--;
            }

            let end = minute;
            while (end < 1439 && activityMinutes[end + 1] === 'ASLEEP') {
                end++;
            }

            const durationMinutes = end - start + 1;
            const hours = Math.floor(durationMinutes / 60);
            const mins = durationMinutes % 60;
            const durationText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

            // Format time range
            const startTime = formatTime(start);
            const endTime = formatTime(end);

            setTooltipState({
                visible: true,
                x: event.native.offsetX, // Use native offset for DOM positioning
                y: event.native.offsetY - 40, // Shift up
                text: `Sleep: ${durationText} (${startTime} - ${endTime})`
            });
        } else {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
        }
    };

    const handleChartLeave = () => {
        setTooltipState({ visible: false, x: 0, y: 0, text: '' });
    };

    const hasData = hrPoints.length > 0 || !activityMinutes.every(m => m === 'BLANK');

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: {
                top: 20,
                bottom: 15,
                left: 10,
                right: 10
            }
        },
        onHover: handleChartHover,
        interaction: {
            mode: 'nearest',
            intersect: true,
            axis: 'x'
        },
        scales: {
            x: {
                type: 'linear',
                min: 0,
                max: 1440,
                ticks: {
                    stepSize: isFullscreen ? 120 : 240, // 2h in FS, 4h otherwise
                    callback: (value) => {
                        const h = Math.floor(value / 60);
                        // Every 4 hours normally (0, 4, 8, 12, 16, 20)
                        // Every 2 hours in fullscreen
                        if (h % 2 !== 0 && !isFullscreen) return ''; // Skip odd hours if not FS
                        if (h % 2 !== 0 && isFullscreen) {
                            // Odd hours logic handled by stepSize + callback
                        }

                        const period = h >= 12 ? 'PM' : 'AM';
                        const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);

                        // We only want to label multiples of 2 if isFullscreen, else multiples of 4
                        if (!isFullscreen && h % 4 !== 0) return '';
                        if (isFullscreen && h % 2 !== 0) return '';

                        return `${h12}${period}`;
                    },
                    color: isDark ? '#94a3b8' : '#64748b',
                    maxTicksLimit: isFullscreen ? 14 : 7,
                },
                grid: {
                    color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)',
                },
                title: { display: false },
            },
            y: {
                beginAtZero: false,
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
            tooltip: { // Standard Chart.js tooltip
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

    if (!hasData) {
        return <div className="stats-no-data">No data for this day</div>;
    }

    return (
        <div
            className="stats-chart-container"
            style={{ height: '350px', position: 'relative' }}
            onMouseLeave={handleChartLeave}
        >
            <Scatter
                ref={chartRef}
                data={data}
                options={options}
                plugins={[activityPlugin, minMaxPlugin]}
            />
            {tooltipState.visible && (
                <div
                    style={{
                        position: 'absolute',
                        left: tooltipState.x,
                        top: tooltipState.y,
                        transform: 'translate(-50%, -100%)',
                        backgroundColor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                        color: isDark ? '#f8fafc' : '#0f172a',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                        pointerEvents: 'none',
                        zIndex: 10,
                        whiteSpace: 'nowrap'
                    }}
                >
                    {tooltipState.text}
                </div>
            )}
        </div>
    );
}
