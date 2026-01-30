import { useRef, useMemo, useState, useLayoutEffect, useCallback, useEffect } from 'react';
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
export default function CombinedChart({ hrPoints = [], activityMinutes = [], walkingMinutes = [], stepCounts = [], sleepSessions = [], isDark, isFullscreen }) {
    const chartRef = useRef(null);
    const [tooltipState, setTooltipState] = useState({ visible: false, x: 0, y: 0, text: '' });

    // Data Refs - Keep these up to date so plugins/callbacks can read fresh data without triggering re-creation
    const activityMinutesRef = useRef(activityMinutes);
    const walkingMinutesRef = useRef(walkingMinutes);
    const sleepSessionsRef = useRef(sleepSessions);
    const stepCountsRef = useRef(stepCounts);
    const isDarkRef = useRef(isDark);
    const isFullscreenRef = useRef(isFullscreen);
    const hrPointsRef = useRef(hrPoints);

    // Update refs on every render (sync with DOM paint)
    useLayoutEffect(() => {
        activityMinutesRef.current = activityMinutes;
        walkingMinutesRef.current = walkingMinutes;
        sleepSessionsRef.current = sleepSessions;
        stepCountsRef.current = stepCounts;
        isDarkRef.current = isDark;
        isFullscreenRef.current = isFullscreen;
        hrPointsRef.current = hrPoints;
    }); // No dep array intended: run on every commit

    // Force chart redraw when fullscreen changes so min/max labels appear
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.update('none');
        }
    }, [isFullscreen]);

    // Memoize chart data
    const data = useMemo(() => ({
        datasets: [
            {
                label: 'Heart Rate',
                data: hrPoints.map(p => ({ x: p.minuteOfDay, y: p.bpm })),
                backgroundColor: isDark ? 'rgba(255, 107, 107, 0.7)' : 'rgba(239, 68, 68, 0.6)',
                pointRadius: 2.5,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#FF6B6B',
                pointHitRadius: 20, // Increased for easier touch
            },
        ],
    }), [hrPoints, isDark]);

    // Stable Activity Plugin - Reads from Refs
    const activityPlugin = useMemo(() => ({
        id: 'activityBackground',
        beforeDraw: (chart) => {
            const actMin = activityMinutesRef.current;
            const walkMin = walkingMinutesRef.current;
            const dark = isDarkRef.current;

            if (!actMin || actMin.length === 0) return;

            const { ctx, chartArea, scales } = chart;
            const { top, height } = chartArea;
            const xScale = scales.x;

            ctx.save();

            // 1. Draw Sleep (Blue)
            const sleepColor = dark ? 'rgba(107, 141, 181, 0.3)' : 'rgba(147, 181, 213, 0.3)';

            if (actMin && actMin.length > 0) {
                ctx.fillStyle = sleepColor;
                let startM = 0;
                let isAsleep = actMin[0] === 'ASLEEP';

                const drawSleepSegment = (start, end) => {
                    const x1 = xScale.getPixelForValue(start);
                    const x2 = xScale.getPixelForValue(end + 1);
                    ctx.fillRect(x1, top, x2 - x1, height);
                };

                for (let m = 1; m < 1440; m++) {
                    const currentAsleep = actMin[m] === 'ASLEEP';
                    if (currentAsleep !== isAsleep) {
                        if (isAsleep) drawSleepSegment(startM, m - 1);
                        isAsleep = currentAsleep;
                        startM = m;
                    }
                }
                if (isAsleep) drawSleepSegment(startM, 1439);
            }

            // 2. Draw Walking (Green) - ON TOP
            const walkColor = dark ? 'rgba(123, 198, 126, 0.6)' : 'rgba(106, 191, 110, 0.6)';

            if (walkMin && walkMin.length > 0) {
                ctx.fillStyle = walkColor;
                let startW = 0;
                let isWalking = walkMin[0];

                const drawWalkSegment = (start, end) => {
                    const x1 = xScale.getPixelForValue(start);
                    const x2 = xScale.getPixelForValue(end + 1);
                    ctx.fillRect(x1, top, x2 - x1, height);
                };

                for (let m = 1; m < 1440; m++) {
                    const currentWalk = walkMin[m];
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
    }), []); // Empty deps = stable instance forever! Refs handle updates.

    // Min/Max Label Plugin - reads from refs for stable identity
    const minMaxPlugin = useMemo(() => ({
        id: 'minMaxLabels',
        afterDatasetsDraw: (chart) => {
            const points = hrPointsRef.current;
            const fullscreen = isFullscreenRef.current;
            const dark = isDarkRef.current;

            if (!fullscreen || !points || points.length === 0) return;

            const { ctx, scales } = chart;
            const xScale = scales.x;
            const yScale = scales.y;

            let minPoint = points[0];
            let maxPoint = points[0];

            points.forEach(p => {
                if (p.bpm < minPoint.bpm) minPoint = p;
                if (p.bpm > maxPoint.bpm) maxPoint = p;
            });

            ctx.save();
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';

            const drawLabel = (point, label, isMax) => {
                const x = xScale.getPixelForValue(point.minuteOfDay);
                const y = yScale.getPixelForValue(point.bpm);

                ctx.fillStyle = dark ? '#ffffff' : '#000000';

                const text = `${label}: ${point.bpm}`;
                const textHeight = 14;
                let yOffset = isMax ? -12 : 25;

                if (isMax && (y + yOffset - textHeight) < scales.y.top) yOffset = 25;
                if (!isMax && (y + yOffset) > scales.y.bottom) yOffset = -12;

                ctx.fillText(text, x, y + yOffset);
            };

            drawLabel(maxPoint, 'Max', true);
            drawLabel(minPoint, 'Min', false);
            ctx.restore();
        }
    }), []); // Stable - reads from refs

    // Stable Hover Handler
    const handleChartHover = useCallback((event, chartElement, chart) => {
        // Reads from Refs to avoid closure staleness
        const actMin = activityMinutesRef.current;
        const sessions = sleepSessionsRef.current;
        const steps = stepCountsRef.current;
        const walkMin = walkingMinutesRef.current;

        // Priority: HR (built-in tooltip) > Steps > Sleep

        // 1. Check for HR points using Chart.js API — built-in tooltip handles these
        const points = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);

        if (points.length > 0) {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const { scales } = chart;
        const mouseX = event.x;
        const mouseY = event.y;

        if (mouseX < scales.x.left || mouseX > scales.x.right || mouseY < scales.y.top || mouseY > scales.y.bottom) {
            setTooltipState({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const minute = Math.floor(scales.x.getValueForPixel(mouseX));

        // 2. Check for steps at this minute (prioritize over sleep)
        // Check nearby minutes (+/- 2) to handle touch imprecision on mobile
        const checkMinutes = [minute, minute - 1, minute + 1, minute - 2, minute + 2].filter(m => m >= 0 && m < 1440);
        for (const m of checkMinutes) {
            if (steps && steps[m] > 0 && walkMin && walkMin[m]) {
                setTooltipState({
                    visible: true,
                    x: event.native.offsetX,
                    y: event.native.offsetY - 40,
                    text: `${formatTime(m)}: ${Math.round(steps[m])} steps`
                });
                return;
            }
        }

        // 3. Check for Sleep Segment
        if (actMin && actMin.length > 0) {
            const activeSession = sessions.find(s => minute >= s.startMin && minute < s.endMin && s.isAsleep);

            if (activeSession) {
                let durationMinutes, startTime, endTime;
                if (activeSession.fullStart && activeSession.fullEnd && activeSession.fullDurationMin) {
                    durationMinutes = activeSession.fullDurationMin;
                    const fs = activeSession.fullStart;
                    const fe = activeSession.fullEnd;
                    const fmtT = (d) => {
                        let h = d.getHours();
                        const m = d.getMinutes();
                        const period = h >= 12 ? 'PM' : 'AM';
                        h = h === 0 ? 12 : h > 12 ? h - 12 : h;
                        return `${h}:${String(m).padStart(2, '0')} ${period}`;
                    };
                    startTime = fmtT(fs);
                    endTime = fmtT(fe);
                } else {
                    durationMinutes = activeSession.endMin - activeSession.startMin;
                    startTime = formatTime(activeSession.startMin);
                    endTime = formatTime(activeSession.endMin);
                }
                const hours = Math.floor(durationMinutes / 60);
                const mins = durationMinutes % 60;
                const durationText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

                setTooltipState({
                    visible: true,
                    x: event.native.offsetX,
                    y: event.native.offsetY - 40,
                    text: `Sleep: ${durationText} (${startTime} - ${endTime})`
                });
                return;
            }
        }

        setTooltipState({ visible: false, x: 0, y: 0, text: '' });
    }, []); // Empty deps = stable callback!

    const handleChartLeave = useCallback(() => {
        setTooltipState({ visible: false, x: 0, y: 0, text: '' });
    }, []);

    const hasData = hrPoints.length > 0 || !(activityMinutes && activityMinutes.every(m => m === 'BLANK'));

    // Stable Options
    const options = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // OFF: Instant updates for HR points
        layout: { padding: { top: 20, bottom: 15, left: 10, right: 10 } },
        onHover: handleChartHover,
        interaction: { mode: 'nearest', intersect: true, axis: 'xy' },
        scales: {
            x: {
                type: 'linear', min: 0, max: 1440,
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
                grid: { color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)' },
                title: { display: false },
            },
            y: {
                beginAtZero: false, suggestedMin: 50, suggestedMax: 120,
                ticks: { color: isDark ? '#94a3b8' : '#64748b' },
                grid: { color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.06)' },
                title: { display: true, text: 'BPM', color: isDark ? '#94a3b8' : '#64748b', font: { size: 11 } },
            },
        },
        plugins: {
            tooltip: {
                enabled: true,
                callbacks: {
                    title: (items) => items.length ? formatTime(items[0].raw.x) : '',
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
    }), [isDark, isFullscreen, handleChartHover]); // Recreate only on theme/layout change

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
