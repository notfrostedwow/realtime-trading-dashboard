import { useEffect, useRef, useState } from "react";
import { current, money, type State, type Symbol } from "./domain";

export function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  return (
    <svg
      className={`sparkline ${up ? "positive" : "negative"}`}
      viewBox="0 0 80 28"
      aria-hidden="true"
    >
      <polyline
        points={values
          .map(
            (v, i) =>
              `${(i / Math.max(1, values.length - 1)) * 80},${25 - ((v - min) / span) * 22}`,
          )
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function Chart({
  state,
  symbol,
}: {
  state: State;
  symbol: Symbol;
}) {
  const [windowSize, setWindowSize] = useState(60);
  const [inspection, setInspection] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setCompact(entry.contentRect.width < 500),
    );
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const frames = state.tape.slice(
    Math.max(0, state.cursor - windowSize + 1),
    state.cursor + 1,
  );
  const values = frames.map((f) => f.prices[symbol]);
  const low = Math.min(...values),
    high = Math.max(...values),
    padding = Math.max(10, (high - low) * 0.16);
  const min = Math.max(0, low - padding),
    max = high + padding;
  const W = compact ? 400 : 800,
    H = compact ? 230 : 190,
    right = W - 70,
    top = 14,
    bottom = H - 49,
    volumeBase = H - 19;
  const x = (i: number) =>
    18 + (i / Math.max(1, frames.length - 1)) * (right - 18);
  const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const index =
    inspection === null
      ? values.length - 1
      : Math.min(inspection, values.length - 1);
  const picked = frames[index],
    last = current(state).prices[symbol];
  const maxVol = Math.max(...frames.map((f) => f.volumes[symbol]), 1);
  return (
    <>
      <div className="chart-toolbar">
        <div className="chart-legend">
          <span className="line-dot" /> Last price{" "}
          <span className="muted">/ USD</span>
        </div>
        <div className="segmented compact" aria-label="Chart range">
          {[
            { n: 12, label: "1 min" },
            { n: 60, label: "5 min" },
            { n: 120, label: "10 min" },
          ].map(({ n, label }) => (
            <button
              key={n}
              aria-pressed={windowSize === n}
              onClick={() => {
                setWindowSize(n);
                setInspection(null);
              }}
            >
              {state.source === "imported" ? `${n} ticks` : label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-readout">
        <time>{picked.timestamp.slice(11, 19)} UTC</time>
        <span>
          PRICE <b>{money(picked.prices[symbol])}</b>
        </span>
        <span>
          VOL <b>{picked.volumes[symbol].toLocaleString("en-US")}</b>
        </span>
      </div>
      <svg
        ref={svg}
        className="price-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby="chart-title chart-description"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const position = ((event.clientX - rect.left) / rect.width) * W;
          setInspection(
            Math.max(
              0,
              Math.min(
                frames.length - 1,
                Math.round(
                  ((position - 18) / (right - 18)) * (frames.length - 1),
                ),
              ),
            ),
          );
        }}
        onPointerLeave={() => setInspection(null)}
      >
        <title id="chart-title">
          {symbol} synthetic price, last {frames.length} ticks
        </title>
        <desc id="chart-description">
          Low {money(low)}, high {money(high)}, latest {money(last)}. Use the
          inspect slider or expand the price table below.
        </desc>
        <defs>
          <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#63cbb6" stopOpacity=".15" />
            <stop offset="100%" stopColor="#63cbb6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => {
          const value = min + ((max - min) * i) / 4;
          return (
            <g key={i}>
              <line
                x1="18"
                x2={right}
                y1={y(value)}
                y2={y(value)}
                className="gridline"
              />
              <text x={right + 14} y={y(value) + 4}>
                {(value / 100).toFixed(2)}
              </text>
            </g>
          );
        })}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={18 + (i * (right - 18)) / 4}
            x2={18 + (i * (right - 18)) / 4}
            y1={top}
            y2={volumeBase}
            className="gridline vertical"
          />
        ))}
        {frames.map((f, i) => (
          <rect
            key={f.timestamp}
            x={x(i) - 2}
            y={volumeBase - (f.volumes[symbol] / maxVol) * 20}
            width={Math.max(2, Math.min(6, (right - 18) / frames.length - 1))}
            height={(f.volumes[symbol] / maxVol) * 20}
            fill="#405662"
            opacity=".75"
          />
        ))}
        <polygon
          points={`18,${bottom} ${points} ${x(values.length - 1)},${bottom}`}
          fill="url(#chart-area)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#6cd1bb"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line
          x1="18"
          x2={right}
          y1={y(last)}
          y2={y(last)}
          stroke="#68cbb6"
          strokeDasharray="3 5"
          opacity=".4"
        />
        <line
          x1={x(index)}
          x2={x(index)}
          y1={top}
          y2={volumeBase}
          stroke="#d8c5a6"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(index)}
          cy={y(values[index])}
          r="4"
          fill="#e9b565"
          stroke="#101820"
          strokeWidth="2"
        />
        {[0, Math.floor((frames.length - 1) / 2), frames.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => (
            <text
              key={frames[i].timestamp}
              x={x(i)}
              y={H - 1}
              textAnchor={
                i === 0 ? "start" : i === frames.length - 1 ? "end" : "middle"
              }
            >
              {frames[i].timestamp.slice(11, 19)}
            </text>
          ))}
      </svg>
      <label className="chart-inspector">
        Inspect tick{" "}
        <input
          aria-label="Inspect chart tick"
          type="range"
          min="0"
          max={frames.length - 1}
          value={index}
          onChange={(e) => setInspection(Number(e.target.value))}
        />
        <span>
          {index + 1} / {frames.length}
        </span>
      </label>
      <details className="chart-table">
        <summary>
          Accessible price table <span>last {frames.length} ticks</span>
        </summary>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Visible {symbol} chart data</caption>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Price (USD)</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {frames.map((f) => (
                <tr key={f.timestamp}>
                  <td>{f.timestamp.slice(11, 19)}</td>
                  <td>{money(f.prices[symbol])}</td>
                  <td>{f.volumes[symbol]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
