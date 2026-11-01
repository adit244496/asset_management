import Chart from 'chart.js/auto';
import { optionLabel } from './dashboardFilters';

export const PALETTE = {
  categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  categoricalDark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  sequential: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  ageing: ['#22c55e', '#84cc16', '#eab308', '#f97316', '#dc2626', '#7f1d1d'],
  ageingDark: ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#f87171', '#b91c1c'],
  ageingHover: ['#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#b91c1c', '#450a0a'],
  ageingDarkHover: ['#86efac', '#bef264', '#fde047', '#fdba74', '#fca5a5', '#dc2626'],
  ink: { primary: '#101828', secondary: '#5b6478', muted: '#98a2b3', grid: '#eceef2', baseline: '#e3e6eb' },
  inkDark: { primary: '#f4f5f7', secondary: '#a4acbb', muted: '#79818f', grid: '#23262d', baseline: '#2b2e35' },
};

Chart.defaults.font.family = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

const ink = (isDark) => (isDark ? PALETTE.inkDark : PALETTE.ink);
const categorical = (isDark) => (isDark ? PALETTE.categoricalDark : PALETTE.categorical);

function mergeScale(base, override = {}) {
  const merged = { ...base, ...override };
  merged.ticks = { ...(base.ticks || {}), ...(override.ticks || {}) };
  return merged;
}

function baseScales(isDark, opts = {}) {
  const I = ink(isDark);
  return {
    x: mergeScale({
      grid: { color: I.grid, drawTicks: false },
      ticks: { color: I.muted, font: { size: 10 } },
      border: { color: I.baseline },
    }, opts.x),
    y: mergeScale({
      grid: { display: false },
      ticks: { color: I.secondary, font: { size: 10.5 } },
      border: { display: false },
    }, opts.y),
  };
}

const tooltipStyle = (isDark) => ({
  backgroundColor: isDark ? '#2b2e35' : '#101828',
  padding: 9,
  cornerRadius: 9,
  titleFont: { size: 11 },
  bodyFont: { size: 11 },
});

export function countBy(rows, key, limit) {
  const counts = {};
  rows.forEach((r) => {
    const v = optionLabel(r[key]);
    counts[v] = (counts[v] || 0) + 1;
  });
  const arr = Object.keys(counts).map((k) => ({ label: k, value: counts[k] }));
  arr.sort((a, b) => b.value - a.value);
  if (limit && arr.length > limit) {
    const head = arr.slice(0, limit - 1);
    const restTotal = arr.slice(limit - 1).reduce((s, x) => s + x.value, 0);
    head.push({ label: 'Other', value: restTotal });
    return head;
  }
  return arr;
}

export function otherBucket(rows, key, limit) {
  const all = countBy(rows, key);
  if (!limit || all.length <= limit) {
    return { total: all.length, hidden: 0, hiddenTotal: 0 };
  }
  const tail = all.slice(limit - 1);
  return {
    total: all.length,
    hidden: tail.length,
    hiddenTotal: tail.reduce((s, x) => s + x.value, 0),
  };
}

function barEndLabelPlugin(I) {
  return {
    id: 'barEndLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 10.5px 'Inter', system-ui, sans-serif";
      ctx.fillStyle = I.primary;
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        ctx.fillText(chart.data.datasets[0].data[i], bar.x + 6, bar.y);
      });
      ctx.restore();
    },
  };
}

function barTopLabelPlugin(I) {
  return {
    id: 'barTopLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 10.5px 'Inter', system-ui, sans-serif";
      ctx.fillStyle = I.primary;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        ctx.fillText(chart.data.datasets[0].data[i], bar.x, bar.y - 4);
      });
      ctx.restore();
    },
  };
}

export function buildSeqBar(rows, key, limit, isDark) {
  return seqBarConfig(countBy(rows, key, limit || 6), isDark, COMPACT_LABEL_CHARS);
}

const COMPACT_LABEL_CHARS = 15;

function shortLabel(label, max) {
  const text = String(label ?? '');
  return max && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function buildBreakdownBar(rows, key, isDark) {
  return seqBarConfig(countBy(rows, key), isDark);
}

function seqBarConfig(data, isDark, maxLabel) {
  const I = ink(isDark);
  const seq = PALETTE.sequential;
  const hue = seq[seq.length - 2];

  return {
    type: 'bar',
    data: {
      labels: data.map((d) => d.label),
      datasets: [{
        data: data.map((d) => d.value),
        backgroundColor: hue,
        borderRadius: 4,
        barPercentage: 0.72,
        categoryPercentage: 0.82,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      layout: { padding: { right: 30 } },
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle(isDark),
      },
      scales: baseScales(isDark, {
        x: { beginAtZero: true, ticks: { precision: 0, font: { size: 9.5 } } },
        y: {
          ticks: {
            autoSkip: false,
            font: { size: 10.5 },
            callback(value) { return shortLabel(this.getLabelForValue(value), maxLabel); },
          },
        },
      }),
    },
    plugins: [barEndLabelPlugin(I)],
  };
}

export function buildCatBar(rows, key, isDark) {
  const data = countBy(rows, key, 8);
  const colors = categorical(isDark);
  const I = ink(isDark);

  return {
    type: 'bar',
    data: {
      labels: data.map((d) => d.label),
      datasets: [{
        data: data.map((d) => d.value),
        backgroundColor: data.map((_, i) => colors[i % colors.length]),
        borderRadius: 4,
        maxBarThickness: 46,
        minBarLength: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle(isDark),
      },
      scales: baseScales(isDark, {
        y: { beginAtZero: true, grid: { color: I.grid, drawTicks: false }, ticks: { precision: 0, font: { size: 9.5 } } },
        x: { ticks: { font: { size: 10 } } },
      }),
    },
    plugins: [barTopLabelPlugin(I)],
  };
}

export function buildAgeingBar(summary, isDark, formatYears, onBandClick) {
  const I = ink(isDark);
  const bands = summary.bands;
  const colors = isDark ? PALETTE.ageingDark : PALETTE.ageing;
  const hoverColors = isDark ? PALETTE.ageingDarkHover : PALETTE.ageingHover;
  const bgColors = bands.map((_, i) => colors[i % colors.length]);
  const hoverBgColors = bands.map((_, i) => hoverColors[i % hoverColors.length]);

  return {
    type: 'bar',
    data: {
      labels: bands.map((b) => b.label),
      datasets: [{
        data: bands.map((b) => b.count),
        backgroundColor: bgColors,
        hoverBackgroundColor: hoverBgColors,
        borderRadius: 4,
        maxBarThickness: 56,
        minBarLength: 3,
        categoryPercentage: 0.82,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      layout: { padding: { top: 18 } },
      interaction: { mode: 'index', intersect: false },
      onClick: onBandClick ? (_event, elements) => {
        const hit = elements[0];
        if (hit && bands[hit.index]?.count) onBandClick(hit.index);
      } : undefined,
      onHover: onBandClick ? (event, elements) => {
        const target = event?.native?.target;
        if (target) target.style.cursor = elements[0] && bands[elements[0].index]?.count ? 'pointer' : 'default';
      } : undefined,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(isDark),
          callbacks: {
            title: (items) => bands[items[0].dataIndex].label,
            footer: (items) => (onBandClick && bands[items[0].dataIndex]?.count
              ? 'Click to see them in the Report' : ''),
            label: (item) => {
              const b = bands[item.dataIndex];
              const pct = (b.share * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 });
              return `${b.count.toLocaleString('en-IN')} items (${pct}% of those with a purchase date)`;
            },
            afterLabel: (item) => {
              const b = bands[item.dataIndex];
              if (!b.count) return '';
              const lines = [`Average age ${formatYears(b.averageYears)}`];
              if (b.poCount) lines.push(`From ${b.poCount.toLocaleString('en-IN')} purchase order${b.poCount === 1 ? '' : 's'}`);
              return lines;
            },
          },
        },
      },
      scales: baseScales(isDark, {
        y: { beginAtZero: true, grid: { color: I.grid, drawTicks: false }, ticks: { precision: 0, font: { size: 9.5 } } },
        x: { ticks: { font: { size: 10 } } },
      }),
    },
    plugins: [barTopLabelPlugin(I)],
  };
}

function stackTotalPlugin(I) {
  return {
    id: 'stackTotal',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const top = chart.getDatasetMeta(chart.data.datasets.length - 1).data;
      ctx.save();
      ctx.font = "600 10px 'Inter', system-ui, sans-serif";
      ctx.fillStyle = I.primary;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      chart.data.labels.forEach((_, i) => {
        const total = chart.data.datasets.reduce((s, ds) => s + (ds.data[i] || 0), 0);
        if (!total || !top[i]) return;
        const y = Math.min(...chart.data.datasets.map((_, d) => chart.getDatasetMeta(d).data[i].y));
        ctx.fillText(total.toLocaleString('en-IN'), top[i].x, y - 3);
      });
      ctx.restore();
    },
  };
}

export function buildLifecycleTrend(trend, isDark) {
  const I = ink(isDark);
  const [newHue, replacedHue] = categorical(isDark);
  const surface = isDark ? '#121826' : '#ffffff';
  const topRadius = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };

  return {
    type: 'bar',
    data: {
      labels: trend.years,
      datasets: [
        {
          label: 'New',
          data: trend.new,
          backgroundColor: newHue,
          maxBarThickness: 34,
          borderRadius: (c) => (trend.replaced[c.dataIndex] ? 0 : topRadius),
          borderSkipped: false,
        },
        {
          label: 'Replaced',
          data: trend.replaced,
          backgroundColor: replacedHue,
          maxBarThickness: 34,
          borderRadius: topRadius,
          borderColor: surface,
          borderWidth: { bottom: 2, top: 0, left: 0, right: 0 },
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 16 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(isDark),
          callbacks: {
            title: (items) => `Bought in ${items[0].label}`,
            label: (item) => ` ${item.dataset.label}: ${item.raw.toLocaleString('en-IN')}`,
            footer: (items) => `Total: ${items.reduce((s, it) => s + (it.raw || 0), 0).toLocaleString('en-IN')}`,
          },
        },
      },
      scales: baseScales(isDark, {
        y: { stacked: true, beginAtZero: true, grid: { color: I.grid, drawTicks: false }, ticks: { precision: 0, font: { size: 9.5 } } },
        x: { stacked: true, ticks: { font: { size: 10 } } },
      }),
    },
    plugins: [stackTotalPlugin(I)],
  };
}

export function lifecycleLegend(isDark) {
  const [newHue, replacedHue] = categorical(isDark);
  return [
    { label: 'New', color: newHue, shape: 'box' },
    { label: 'Replaced', color: replacedHue, shape: 'box' },
  ];
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export function buildTrend(rows, dateKey, isDark) {
  const counts = {};
  rows.forEach((r) => {
    const d = r[dateKey];
    if (!d) return;
    const year = String(d).slice(0, 4);
    if (!/^\d{4}$/.test(year)) return;
    counts[year] = (counts[year] || 0) + 1;
  });
  const years = Object.keys(counts).sort();
  const I = ink(isDark);
  const lineColor = isDark ? PALETTE.categoricalDark[0] : PALETTE.categorical[0];

  return {
    type: 'line',
    data: {
      labels: years,
      datasets: [{
        data: years.map((y) => counts[y]),
        borderColor: lineColor,
        backgroundColor: hexToRgba(lineColor, 0.14),
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: lineColor,
        pointBorderColor: isDark ? '#1a1a19' : '#fcfcfb',
        pointBorderWidth: 1.5,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle(isDark),
      },
      scales: baseScales(isDark, {
        y: { beginAtZero: true, grid: { color: I.grid, drawTicks: false }, ticks: { precision: 0, font: { size: 9.5 } } },
        x: { ticks: { font: { size: 10 } } },
      }),
    },
  };
}

export function statusColor(status, statusOptions, isDark) {
  const palette = categorical(isDark);
  const idx = statusOptions.indexOf(status);
  return palette[(idx >= 0 ? idx : 0) % palette.length];
}

export { Chart };
