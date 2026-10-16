import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  account,
  ASSETS,
  CAPS,
  current,
  integer,
  money,
  parsePrice,
  signedMoney,
  SYMBOLS,
  type Symbol,
} from "./domain";
import { exportLedger, exportReplay, MAX_BYTES, parseReplayCsv } from "./csv";
import { loadSession, serialize, STORAGE_KEY } from "./persistence";
import Chart, { Sparkline } from "./Chart";
import {
  isAltered,
  session,
  sessionReducer,
  type Replacement,
} from "./replacement";

function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const signClass = (value: number) => (value >= 0 ? "positive" : "negative");

export default function App() {
  const [model, dispatch] = useReducer(sessionReducer, undefined, () =>
    session(loadSession()),
  );
  const { current: state, pending, validating: busy } = model;
  const [symbol, setSymbol] = useState<Symbol>("ASTR");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState("10");
  const [limit, setLimit] = useState("180.00");
  const [tab, setTab] = useState<"positions" | "orders" | "ledger">(
    "positions",
  );
  const [seed, setSeed] = useState(() => String(state.seed));
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const replacementDialog = useRef<HTMLDialogElement>(null);
  const keepReplacement = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);
  const stats = account(state),
    frame = current(state);
  const asset = ASSETS.find((a) => a.symbol === symbol)!;
  const last = frame.prices[symbol],
    opening = state.tape[0].prices[symbol],
    delta = last - opening;
  const openOrders = state.orders.filter((o) => o.status === "open");
  const positions = SYMBOLS.filter((s) => state.positions[s].quantity > 0);
  const estimatedPrice = kind === "market" ? last : parsePrice(limit);
  const estimate =
    /^\d+$/.test(quantity) && Number.isFinite(estimatedPrice)
      ? Number(quantity) * estimatedPrice
      : NaN;
  const notice = replacementError
    ? { tone: "error" as const, text: replacementError }
    : state.notice;

  useEffect(() => {
    if (!state.running || busy || pending) return;
    const timer = window.setInterval(
      () => dispatch({ type: "step" }),
      1000 / state.speed,
    );
    return () => window.clearInterval(timer);
  }, [state.running, state.speed, busy, pending]);
  useEffect(() => {
    if (!pending) return;
    const modal = replacementDialog.current;
    modal?.showModal();
    keepReplacement.current?.focus();
    return () => modal?.close();
  }, [pending]);
  useEffect(() => {
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, serialize(state));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    };
    const timer = window.setTimeout(persist, 100);
    window.addEventListener("pagehide", persist);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", persist);
    };
  }, [state]);
  useEffect(
    () => () => {
      importGeneration.current++;
    },
    [],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    setReplacementError(null);
    dispatch({
      type: "order",
      input: {
        symbol,
        side,
        kind,
        quantity: /^\d+$/.test(quantity) ? Number(quantity) : NaN,
        limit: kind === "market" ? null : parsePrice(limit),
      },
    });
  }
  function reset() {
    importGeneration.current++;
    dispatch({ type: "reset" });
    setReplacementError(null);
    dialog.current?.close();
    setQuantity("10");
  }
  function requestReplacement(replacement: Replacement) {
    if (!isAltered(state)) setReplacementError(null);
    dispatch(replacement);
  }
  function confirmReplacement() {
    setReplacementError(null);
    dispatch({ type: "confirm-replacement" });
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy || pending) return;
    if (file.size > MAX_BYTES) {
      setReplacementError("Import rejected: file exceeds 512 KiB.");
      return;
    }
    const generation = ++importGeneration.current;
    dispatch({ type: "begin-import-validation" });
    try {
      const tape = parseReplayCsv(await file.text());
      if (importGeneration.current === generation)
        requestReplacement({ type: "import", tape });
    } catch (error) {
      if (importGeneration.current === generation)
        setReplacementError(
          `Import rejected: ${error instanceof Error ? error.message : "File could not be read."}`,
        );
    } finally {
      if (importGeneration.current === generation)
        dispatch({ type: "finish-import-validation" });
    }
  }
  function exportFile(ledger: boolean) {
    setReplacementError(null);
    download(
      ledger ? "signal-foundry-ledger.csv" : "signal-foundry-replay.csv",
      ledger ? exportLedger(state.orders) : exportReplay(state.tape),
    );
    dispatch({
      type: "notice",
      tone: "success",
      text: `${ledger ? "Ledger" : "Replay"} CSV exported locally. All records are synthetic.`,
    });
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs = ["positions", "orders", "ledger"] as const;
    const index = tabs.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % 3
        : event.key === "ArrowLeft"
          ? (index + 2) % 3
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : null;
    if (next !== null) {
      event.preventDefault();
      setTab(tabs[next]);
      document.getElementById(`tab-${tabs[next]}`)?.focus();
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to replay workspace
      </a>
      <header className="masthead">
        <a
          className="brand"
          href="#workspace"
          aria-label="Signal Foundry workspace"
        >
          <span className="brand-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            SIGNAL<span className="brand-light">FOUNDRY</span>
            <small>MARKET SIMULATION LAB</small>
          </span>
        </a>
        <div className="header-context">
          <span className="context-slash">/</span> REPLAY DESK{" "}
          <span className="version">V1.0</span>
        </div>
        <div className="demo-badge">
          <span /> DEMO · SYNTHETIC DATA
        </div>
        <span className="offline-status">
          LOCAL SESSION <span className="status-dot" />
        </span>
      </header>
      <main id="workspace">
        <section className="desk-heading" aria-labelledby="desk-title">
          <div>
            <p className="eyebrow">
              WORKSPACE 01 <span>/</span> PAPER EXECUTION
            </p>
            <h1 id="desk-title">A market on your terms.</h1>
            <p className="subtitle">
              Replay the tape. Test a decision. Understand the execution.
            </p>
          </div>
          <div className="session-label">
            <span className="muted">
              SESSION /{" "}
              {state.source === "seeded"
                ? `SEED ${state.seed}`
                : "IMPORTED TAPE"}
            </span>
            <strong>
              {frame.timestamp.slice(0, 10)} <span className="muted">UTC</span>
            </strong>
            <span>All prices & balances are simulated.</span>
          </div>
        </section>
        <section className="account-strip" aria-label="Paper account overview">
          <div className="account-label">
            <span className="mini-mark">P</span>
            <div>
              <span className="eyebrow">PAPER ACCOUNT</span>
              <strong>Sandbox / USD</strong>
            </div>
          </div>
          <div className="metric">
            <span>Total equity</span>
            <strong data-testid="equity">{money(stats.equity)}</strong>
            <small>$100,000 starting capital</small>
          </div>
          <div className="metric">
            <span>Available cash</span>
            <strong data-testid="cash">{money(stats.available)}</strong>
            <small>{money(stats.reserved)} reserved</small>
          </div>
          <div className="metric">
            <span>Unrealized P&L</span>
            <strong
              className={signClass(stats.unrealized)}
              data-testid="unrealized"
            >
              {signedMoney(stats.unrealized)}
            </strong>
            <small>
              Realized{" "}
              <span className={signClass(state.realized)}>
                {signedMoney(state.realized)}
              </span>
            </small>
          </div>
          <div className="metric exposure-metric">
            <span>
              Gross exposure{" "}
              <b>{((stats.exposure / CAPS.gross) * 100).toFixed(1)}%</b>
            </span>
            <strong>
              {money(stats.exposure)} <em>/ $60,000</em>
            </strong>
            <progress
              aria-label="Gross exposure versus risk cap"
              value={Math.min(stats.exposure, CAPS.gross)}
              max={CAPS.gross}
            />
          </div>
        </section>
        <section className="replay-bar" aria-label="Replay controls">
          <div className="replay-state">
            <span className={state.running ? "status-dot" : "paused-dot"} />
            <strong>
              {state.running
                ? "REPLAYING"
                : state.cursor === state.tape.length - 1
                  ? "COMPLETE"
                  : "PAUSED"}
            </strong>
            <time data-testid="replay-time">
              {frame.timestamp.slice(11, 19)}
            </time>
            <span className="muted">UTC</span>
          </div>
          <div className="playback-controls">
            <button
              className="primary play-button"
              onClick={() => dispatch({ type: "toggle" })}
              disabled={busy || state.cursor === state.tape.length - 1}
              aria-label={state.running ? "Pause replay" : "Play replay"}
            >
              <span aria-hidden="true">{state.running ? "Ⅱ" : "▶"}</span>{" "}
              {state.running ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => dispatch({ type: "step" })}
              disabled={
                busy || state.running || state.cursor === state.tape.length - 1
              }
              aria-label="Step one tick"
            >
              Step <span aria-hidden="true">↦</span>
            </button>
            <label className="speed-label">
              Speed
              <select
                aria-label="Replay speed"
                value={state.speed}
                onChange={(e) =>
                  dispatch({ type: "speed", value: Number(e.target.value) })
                }
              >
                {[1, 2, 4, 8].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            <button
              className="reset-button"
              disabled={busy}
              onClick={() => dialog.current?.showModal()}
            >
              ↺ Reset
            </button>
          </div>
          <div className="replay-progress">
            <progress
              aria-label="Replay progress"
              value={state.cursor - state.start}
              max={state.tape.length - 1 - state.start}
            />
            <span data-testid="tick-count">
              {state.cursor - state.start} /{" "}
              {state.tape.length - 1 - state.start} ticks
            </span>
          </div>
          <span className="tick-cadence">
            {state.source === "seeded" ? "5s / tick" : "CSV timestamps"} ·
            deterministic
          </span>
        </section>
        <div className="trading-grid">
          <section
            className="panel watchlist"
            aria-labelledby="watchlist-title"
          >
            <div className="panel-heading">
              <h2 id="watchlist-title">Watchlist</h2>
              <span className="subtle-badge">04</span>
            </div>
            <div className="watchlist-caption">
              <span>INSTRUMENT</span>
              <span>LAST / Δ SESSION</span>
            </div>
            {ASSETS.map((a) => {
              const price = frame.prices[a.symbol],
                change = price - state.tape[0].prices[a.symbol];
              return (
                <button
                  className={`watch-item ${symbol === a.symbol ? "selected" : ""}`}
                  key={a.symbol}
                  onClick={() => setSymbol(a.symbol)}
                  aria-pressed={symbol === a.symbol}
                  aria-label={`Select ${a.symbol}, ${a.name}`}
                >
                  <div className="watch-top">
                    <strong>{a.symbol}</strong>
                    <b>{money(price)}</b>
                  </div>
                  <div className="watch-bottom">
                    <span>{a.name}</span>
                    <span className={signClass(change)}>
                      {change >= 0 ? "+" : "−"}
                      {Math.abs(
                        (change / state.tape[0].prices[a.symbol]) * 100,
                      ).toFixed(2)}
                      %
                    </span>
                  </div>
                  <Sparkline
                    values={state.tape
                      .slice(Math.max(0, state.cursor - 29), state.cursor + 1)
                      .map((f) => f.prices[a.symbol])}
                    up={change >= 0}
                  />
                  <span className="watch-sector">{a.sector}</span>
                </button>
              );
            })}
            <div className="watchlist-note">
              <span className="small-cross" aria-hidden="true">
                ✳
              </span>
              <strong>Built for deliberate practice.</strong>
              <p>
                Fictional instruments. Reproducible prices. Zero market
                connection.
              </p>
            </div>
          </section>
          <section
            className="panel chart-panel"
            aria-labelledby="instrument-title"
          >
            <div className="instrument-heading">
              <div>
                <div className="instrument-title">
                  <span className="instrument-icon">{symbol.slice(0, 1)}</span>
                  <div>
                    <h2 id="instrument-title">
                      {symbol} <span>/ USD</span>
                    </h2>
                    <p>
                      {asset.name} <span>· {asset.sector}</span>
                    </p>
                  </div>
                </div>
              </div>
              <span className="subtle-badge synthetic-label">SYNTHETIC</span>
            </div>
            <div className="instrument-price">
              <strong>{money(last)}</strong>
              <span className={signClass(delta)}>
                {signedMoney(delta)} ({delta >= 0 ? "+" : "−"}
                {Math.abs((delta / opening) * 100).toFixed(2)}%)
                <small>vs. session open</small>
              </span>
            </div>
            <Chart key={symbol} state={state} symbol={symbol} />
          </section>
          <section className="panel order-panel" aria-labelledby="order-title">
            <div className="panel-heading">
              <h2 id="order-title">Order ticket</h2>
              <span className="subtle-badge">PAPER</span>
            </div>
            <form onSubmit={submit} noValidate>
              <div className="segmented side-toggle">
                <button
                  type="button"
                  aria-pressed={side === "buy"}
                  className={side === "buy" ? "buy-active" : ""}
                  onClick={() => setSide("buy")}
                >
                  Buy / long
                </button>
                <button
                  type="button"
                  aria-pressed={side === "sell"}
                  className={side === "sell" ? "sell-active" : ""}
                  onClick={() => setSide("sell")}
                >
                  Sell / close
                </button>
              </div>
              <div className="ticket-symbol">
                <span>Instrument</span>
                <strong>
                  {symbol} <span>USD</span>
                </strong>
              </div>
              <label>
                Order type
                <select
                  aria-label="Order type"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                </select>
              </label>
              <div className="quantity-row">
                <label>
                  Quantity
                  <input
                    aria-label="Order quantity"
                    inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <span>
                  SHARES
                  <br />
                  <small>Whole units only</small>
                </span>
              </div>
              {kind === "limit" && (
                <label>
                  Limit price · USD
                  <input
                    aria-label="Limit price"
                    inputMode="decimal"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              )}
              <div className="order-estimate">
                <span>Estimated {side === "buy" ? "cost" : "proceeds"}</span>
                <strong>
                  {Number.isSafeInteger(estimate) && estimate > 0
                    ? money(estimate)
                    : "—"}
                </strong>
                <span>Available {side === "buy" ? "cash" : "shares"}</span>
                <span>
                  {side === "buy"
                    ? money(stats.available)
                    : `${state.positions[symbol].quantity - openOrders.filter((o) => o.symbol === symbol && o.side === "sell").reduce((n, o) => n + o.quantity, 0)} shares`}
                </span>
              </div>
              <button
                className={`submit-order ${side === "buy" ? "" : "sell-submit"}`}
                disabled={busy}
                type="submit"
              >
                Place paper {side} <span aria-hidden="true">↗</span>
              </button>
              <p className="ticket-disclaimer">
                Simulated fills at the replay price.
                <br />
                No fees, slippage, or real money.
              </p>
            </form>
            <div className="risk-summary">
              <strong>
                <span aria-hidden="true">◇</span> RISK GUARDRAILS
              </strong>
              <dl>
                <div>
                  <dt>Max order</dt>
                  <dd>100 shares</dd>
                </div>
                <div>
                  <dt>Per symbol</dt>
                  <dd>$25,000</dd>
                </div>
                <div>
                  <dt>Gross exposure</dt>
                  <dd>$60,000</dd>
                </div>
              </dl>
              <span>Long only · no leverage · limits reserved</span>
            </div>
          </section>
          <section className="panel blotter" aria-label="Account blotter">
            <div className="blotter-header">
              <div className="tabs" role="tablist" aria-label="Account views">
                {(["positions", "orders", "ledger"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    id={`tab-${t}`}
                    aria-controls="account-table"
                    aria-selected={tab === t}
                    tabIndex={tab === t ? 0 : -1}
                    onKeyDown={tabKey}
                    onClick={() => setTab(t)}
                  >
                    {t === "positions"
                      ? "Positions"
                      : t === "orders"
                        ? "Open orders"
                        : "Execution ledger"}{" "}
                    <span>
                      {t === "positions"
                        ? positions.length
                        : t === "orders"
                          ? openOrders.length
                          : state.orders.length}
                    </span>
                  </button>
                ))}
              </div>
              <button className="text-button" onClick={() => exportFile(true)}>
                Export ledger <span aria-hidden="true">↓</span>
              </button>
            </div>
            <div
              id="account-table"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              tabIndex={0}
            >
              {tab === "positions" ? (
                positions.length ? (
                  <div className="table-scroll">
                    <table>
                      <caption className="sr-only">Paper positions</caption>
                      <thead>
                        <tr>
                          <th>Instrument</th>
                          <th>Shares</th>
                          <th>Avg. cost</th>
                          <th>Last</th>
                          <th>Market value</th>
                          <th>Unrealized P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((s) => {
                          const p = state.positions[s],
                            pnl = p.quantity * frame.prices[s] - p.cost;
                          return (
                            <tr key={s}>
                              <th scope="row">{s}</th>
                              <td>{p.quantity}</td>
                              <td>{money(Math.round(p.cost / p.quantity))}</td>
                              <td>{money(frame.prices[s])}</td>
                              <td>{money(p.quantity * frame.prices[s])}</td>
                              <td className={signClass(pnl)}>
                                {signedMoney(pnl)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon" aria-hidden="true">
                      ⌁
                    </span>
                    <div>
                      <strong>Your first decision starts here.</strong>
                      <p>
                        Place a paper order to open a position and follow its
                        P&L through the replay.
                      </p>
                    </div>
                    <span className="empty-meta">NO OPEN POSITIONS</span>
                  </div>
                )
              ) : (
                <div className="table-scroll">
                  {(tab === "orders" ? openOrders : state.orders).length ? (
                    <table>
                      <caption className="sr-only">
                        {tab === "orders"
                          ? "Open paper orders"
                          : "Paper execution ledger"}
                      </caption>
                      <thead>
                        <tr>
                          <th>Order / UTC</th>
                          <th>Instrument</th>
                          <th>Side / type</th>
                          <th>Shares</th>
                          <th>{tab === "orders" ? "Limit" : "Fill / limit"}</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(tab === "orders" ? openOrders : state.orders)]
                          .reverse()
                          .map((o) => (
                            <tr key={o.id}>
                              <th scope="row">
                                #{String(o.id).padStart(3, "0")}{" "}
                                <small>{o.timestamp.slice(11, 19)}</small>
                              </th>
                              <td>{o.symbol}</td>
                              <td>
                                <span
                                  className={
                                    o.side === "buy" ? "positive" : "negative"
                                  }
                                >
                                  {o.side.toUpperCase()}
                                </span>{" "}
                                <span className="muted">{o.kind}</span>
                              </td>
                              <td>{o.quantity}</td>
                              <td>
                                {o.fillPrice !== null
                                  ? money(o.fillPrice)
                                  : o.limit !== null
                                    ? money(o.limit)
                                    : "—"}
                              </td>
                              <td>
                                <span
                                  className={`order-status ${o.status}`}
                                  title={o.reason}
                                >
                                  {o.status}
                                </span>
                                {o.status === "open" && (
                                  <button
                                    className="cancel-order"
                                    aria-label={`Cancel order ${o.id}`}
                                    onClick={() =>
                                      dispatch({ type: "cancel", id: o.id })
                                    }
                                  >
                                    Cancel
                                  </button>
                                )}
                                {o.status === "rejected" && (
                                  <small className="negative">{o.reason}</small>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon" aria-hidden="true">
                        ≋
                      </span>
                      <div>
                        <strong>
                          {tab === "orders"
                            ? "No orders waiting in the wings."
                            : "A clean execution record."}
                        </strong>
                        <p>
                          {tab === "orders"
                            ? "Limit orders rest here until the replay reaches your price."
                            : "Accepted orders and their outcomes will appear here. Invalid submissions are explained above."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="blotter-footer">
              <span>
                Cash balance <b>{money(state.cash)}</b>
              </span>
              <span>
                Realized P&L{" "}
                <b className={signClass(state.realized)}>
                  {signedMoney(state.realized)}
                </b>
              </span>
              <span>
                Orders <b>{state.orders.length} / 200</b>
              </span>
            </div>
          </section>
        </div>
        <div
          className={`notice ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span aria-hidden="true">
            {notice.tone === "error"
              ? "!"
              : notice.tone === "success"
                ? "✓"
                : "i"}
          </span>
          {notice.text}
        </div>
        {storageError && (
          <p className="storage-error" role="alert">
            Local storage is unavailable or full. This session still works in
            memory; export your CSV before leaving.
          </p>
        )}
        <section className="data-dock" aria-labelledby="data-title">
          <div>
            <h2 id="data-title">Your tape. Your experiment.</h2>
            <p>
              Replay CSV · exact schema · max 512 KiB / 4,000 rows. Import
              replaces this session and resets the account.
            </p>
          </div>
          <div className="data-actions">
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              aria-label="Import replay CSV file"
              className="sr-only"
              onChange={importFile}
            />
            <button disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "Validating…" : "↑ Import replay"}
            </button>
            <button onClick={() => exportFile(false)}>↓ Export replay</button>
          </div>
          <details className="data-details">
            <summary>CSV contract & session seed</summary>
            <div className="data-contract">
              <div>
                <code>timestamp,symbol,price_cents,volume</code>
                <p>
                  Canonical UTC ISO timestamps, ascending. Every timestamp needs
                  ASTR, BRIK, COVE, VOLT in that order. Integer price cents:
                  1–1,000,000. Volume: 0–1,000,000. At least 8 rows. No quotes,
                  formulas, duplicates, or extra fields. Export a tape to get a
                  valid example.
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = /^\d+$/.test(seed) ? Number(seed) : NaN;
                  if (!integer(value, 0, 0xffffffff)) {
                    setReplacementError(
                      "Seed must be an integer from 0 to 4294967295.",
                    );
                    return;
                  }
                  requestReplacement({
                    type: "reset",
                    seed: value,
                  });
                }}
              >
                <label>
                  Deterministic seed
                  <input
                    aria-label="Session seed"
                    inputMode="numeric"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                  />
                </label>
                <button disabled={busy} type="submit">
                  Load seed & reset
                </button>
              </form>
            </div>
          </details>
        </section>
        <footer className="page-footer">
          <span>
            <span className="status-dot" /> OFFLINE BY DESIGN{" "}
            <span className="footer-divider">/</span> SAVED ON THIS DEVICE
          </span>
          <span>
            Synthetic market simulation. No trading advice.{" "}
            <b>Signal Foundry © 2026 Zaheer Miah</b>
          </span>
        </footer>
      </main>
      <dialog ref={dialog} aria-labelledby="reset-title">
        <form method="dialog">
          <p className="eyebrow">START A CLEAN RUN</p>
          <h2 id="reset-title">Reset this session?</h2>
          <p>
            Restore the current tape to its starting tick, $100,000 cash, and no
            orders or positions. The saved account is replaced.
          </p>
          <div className="dialog-actions">
            <button value="cancel">Keep session</button>
            <button type="button" className="primary" onClick={reset}>
              Reset session
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={replacementDialog}
        className="replacement-dialog"
        aria-labelledby="replacement-title"
        aria-describedby="replacement-description"
        onCancel={(event) => {
          event.preventDefault();
          dispatch({ type: "cancel-replacement" });
        }}
      >
        <p className="eyebrow">REPLACE CURRENT SESSION</p>
        <h2 id="replacement-title">Replace this session?</h2>
        <p id="replacement-description">
          {pending?.type === "import"
            ? `Import the validated replay (${pending.tape.length} timestamps)`
            : `Load seed ${pending?.type === "reset" ? pending.seed : ""}`}{" "}
          and replace your replay, cash, positions, open orders, and execution
          ledger with a fresh $100,000 account. Replay is held until you choose.
        </p>
        <div className="dialog-actions">
          <button
            ref={keepReplacement}
            type="button"
            onClick={() => dispatch({ type: "cancel-replacement" })}
          >
            Keep current session
          </button>
          <button
            type="button"
            className="primary"
            onClick={confirmReplacement}
          >
            {pending?.type === "import"
              ? "Import replay & replace"
              : "Load seed & replace"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
