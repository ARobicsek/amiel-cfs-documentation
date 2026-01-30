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
export default function CombinedChart({ hrPoints = [], activityMinutes = [], walkingMinutes = [], sleepSessions = [], isDark, isFullscreen }) {
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
                // Add a hit radius to make it easier to touch
                pointHitRadius: 15,
            },
        ],
    }), [hrPoints, isDark]);

    // Activity Background Plugin
    const activityPlugin = useMemo(() => ({
        id: 'activityBackground',
        beforeDraw: (chart) => {
            const { ctx, chartArea, scales } = chart;
            const { top, height } = chartArea;
            const xScale = scales.x;

            ctx.save();

            // 1. Draw Sleep (Blue) from activityMinutes
            const sleepColor = isDark ? 'rgba(107, 141, 181, 0.3)' : 'rgba(147, 181, 213, 0.3)';

            if (activityMinutes && activityMinutes.length > 0) {
                ctx.fillStyle = sleepColor;
                let startM = 0;
                let isAsleep = activityMinutes[0] === 'ASLEEP';

                const drawSleepSegment = (start, end) => {
                    const x1 = xScale.getPixelForValue(start);
                    const x2 = xScale.getPixelForValue(end + 1);
                    ctx.fillRect(x1, top, x2 - x1, height);
                };

                for (let m = 1; m < 1440; m++) {
                    const currentAsleep = activityMinutes[m] === 'ASLEEP';
                    if (currentAsleep !== isAsleep) {
                        if (isAsleep) drawSleepSegment(startM, m - 1);
                        isAsleep = currentAsleep;
                        startM = m;
                    }
                }
                if (isAsleep) drawSleepSegment(startM, 1439);
            }

            // 2. Draw Walking (Green) from walkingMinutes - ON TOP
            const walkColor = isDark ? 'rgba(123, 198, 126, 0.6)' : 'rgba(106, 191, 110, 0.6)';

            if (walkingMinutes && walkingMinutes.length > 0) {
                ctx.fillStyle = walkColor;
                let startW = 0;
                let isWalking = walkingMinutes[0];

                const drawWalkSegment = (start, end) => {
                    const x1 = xScale.getPixelForValue(start);
                    const x2 = xScale.getPixelForValue(end + 1);
                    ctx.fillRect(x1, top, x2 - x1, height);
                };

                for (let m = 1; m < 1440; m++) {
                    const currentWalk = walkingMinutes[m];
                    if (currentWalk !== isWalking) {
                        if (isWalking) drawWalkSegment(startW, m - 1);
                        isWalking = currentWalk;
                        startW = m;
                    }
                }
                if (isWalking) drawWalkSegment(startW, 1439);
            }

            ctx.restore();
        }
    }), [activityMinutes, walkingMinutes, isDark]);

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
            ctx.font = 'bold 14px sans-serif'; // Increased font size
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';

            const drawLabel = (point, label, isMax) => {
                const x = xScale.getPixelForValue(point.minuteOfDay);
                const y = yScale.getPixelForValue(point.bpm);

                // Colors
                ctx.fillStyle = isDark ? '#ffffff' : '#000000';
                ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)';
                ctx.lineWidth = 4;

                const text = `${label}: ${point.bpm}`;
                const textHeight = 14;
                let yOffset = isMax ? -12 : 25; // Max above, Min below

                // Collision detection
                if (isMax && (y + yOffset - textHeight) < scales.y.top) {
                    yOffset = 25; // Flip to below if blocked above
                }
                if (!isMax && (y + yOffset) > scales.y.bottom) {
                    yOffset = -12; // Flip to above if blocked below
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
        // 1. Check for HR points (Chart.js interaction)
        const points = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);

        if (points.length > 0) {
            // Hovering over an HR point - let Chart.js tooltip show (hide custom tooltip)
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        // 2. Check for Sleep Segment
        if (!activityMinutes || activityMinutes.length === 0) {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const { scales } = chart;
        const mouseX = event.x;
        const mouseY = event.y;

        // Check bounds
        if (mouseX < scales.x.left || mouseX > scales.x.right || mouseY < scales.y.top || mouseY > scales.y.bottom) {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const minute = Math.floor(scales.x.getValueForPixel(mouseX));

        // Find which sleep session this minute belongs to (if any)
        // activityMinutes tells us if it is ASLEEP, but sleepSessions gives us the full clean block
        const activeSession = sleepSessions.find(s => minute >= s.startMin && minute <= s.endMin && s.isAsleep);

        if (activeSession) {
            const start = activeSession.startMin;
            const end = activeSession.endMin;

            const durationMinutes = end - start; // duration
            const hours = Math.floor(durationMinutes / 60);
            const mins = durationMinutes % 60;
            const durationText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

            // Format time range
            const startTime = formatTime(start);
            const endTime = formatTime(end);

            setTooltipState({
                visible: true,
                x: event.native.offsetX,
                y: event.native.offsetY - 40,
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
            axis: 'xy' // Allow finding closest point in 2D
        },
        scales: {
            x: {
                type: 'linear',
                min: 0,
                max: 1440,
                ticks: {
                    stepSize: isFullscreen ? 120 : 240,
                    callback: (value) => {
                        const h = Math.floor(value / 60);
                        if (!isFullscreen && h % 4 !== 0) return '';
                        if (isFullscreen && h % 2 !== 0) return '';

                        const period = h >= 12 ? 'PM' : 'AM';
                        const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
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
            tooltip: {
                // We want Chart.js tooltip for HR points
                enabled: true,
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
                        backgroundColor: isDark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                        color: isDark ? '#f8fafc' : '#0f172a',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '600',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                        pointerEvents: 'none',
                        zIndex: 20,
                        whiteSpace: 'nowrap'
                    }}
                >
                    {tooltipState.text}
                </div>
            )}
        </div>
    );
}
