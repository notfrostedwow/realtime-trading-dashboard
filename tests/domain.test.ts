import { describe, expect, it } from "vitest";
import {
  account,
  CAPS,
  createState,
  DEFAULT_SEED,
  generateTape,
  INITIAL_CASH,
  parsePrice,
  records,
  reducer,
  step,
  type Frame,
  type OrderInput,
  type State,
} from "../src/domain";
import { deserialize, serialize } from "../src/persistence";
import {
  CSV_HEADER,
  exportLedger,
  exportReplay,
  MAX_BYTES,
  parseReplayCsv,
  safeCell,
} from "../src/csv";

const tape = (prices: number[]): Frame[] =>
  prices.map((price, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 12, 9, 30, i * 5)).toISOString(),
    prices: records(() => price),
    volumes: records(() => 500),
  }));
const order = (s: State, overrides: Partial<OrderInput> = {}) =>
  reducer(s, {
    type: "order",
    input: {
      symbol: "ASTR",
      side: "buy",
      kind: "market",
      quantity: 10,
      limit: null,
      ...overrides,
    },
  });
const advance = (s: State, n: number) => {
  for (let i = 0; i < n; i++) s = step(s);
  return s;
};

describe("deterministic replay", () => {
  it("reproduces all frames from a seed with canonical five-second UTC timestamps", () => {
    const a = generateTape(DEFAULT_SEED),
      b = generateTape(DEFAULT_SEED);
    expect(a).toEqual(b);
    expect(generateTape(42)).not.toEqual(a);
    expect(generateTape(0)).toEqual(generateTape(0));
    expect(a).toHaveLength(660);
    for (let i = 1; i < a.length; i++)
      expect(Date.parse(a[i].timestamp) - Date.parse(a[i - 1].timestamp)).toBe(
        5000,
      );
  });
  it("steps once, bounds the end, and starts paused", () => {
    const initial = createState();
    expect(initial.running).toBe(false);
    expect(step(initial).cursor).toBe(initial.cursor + 1);
    const end = advance({ ...initial, running: true }, 900);
    expect(end.cursor).toBe(659);
    expect(end.running).toBe(false);
    expect(step(end).cursor).toBe(659);
  });
  it("reset restores seed, cursor, cash, basis, P&L, reservations, speed and journal", () => {
    let s = order(createState());
    s = advance(s, 10);
    s = order(s, { side: "sell", quantity: 3 });
    expect(s.realized).not.toBe(0);
    s = order(s, { kind: "limit", limit: 100, quantity: 5 });
    s = reducer(s, { type: "speed", value: 8 });
    expect(reducer(s, { type: "reset" })).toEqual(createState());
  });
  it("resets imported sessions to their own first frame", () => {
    const frames = tape([10000, 11000]);
    const s = step(order(createState(99, frames)));
    expect(reducer(s, { type: "reset" })).toEqual(createState(99, frames));
    expect(reducer(s, { type: "reset", seed: 12 })).toEqual(createState(12));
  });
  it("rejects invalid seeds and playback speeds", () => {
    const s = createState();
    expect(reducer(s, { type: "reset", seed: NaN }).notice.tone).toBe("error");
    expect(reducer(s, { type: "speed", value: Infinity })).toBe(s);
  });
});

describe("paper accounting and order invariants", () => {
  it("debits cash, marks positions, realizes partial sales and closes basis exactly", () => {
    let s = order(createState(1, tape([10000, 11000, 9000])), { quantity: 3 });
    expect(s.cash).toBe(INITIAL_CASH - 30000);
    expect(s.positions.ASTR).toEqual({ quantity: 3, cost: 30000 });
    s = step(s);
    expect(account(s).unrealized).toBe(3000);
    expect(account(s).equity).toBe(INITIAL_CASH + 3000);
    s = order(s, { side: "sell", quantity: 1 });
    expect(s.realized).toBe(1000);
    expect(s.positions.ASTR.cost).toBe(20000);
    s = step(s);
    expect(account(s).unrealized).toBe(-2000);
    s = order(s, { side: "sell", quantity: 2 });
    expect(s.realized).toBe(-1000);
    expect(s.cash).toBe(INITIAL_CASH - 1000);
    expect(s.positions.ASTR).toEqual({ quantity: 0, cost: 0 });
    expect(account(s).equity).toBe(s.cash);
  });
  it("allocates rounding remainder to remaining basis with no lost cents", () => {
    let s = order(createState(1, tape([10001, 10002])), { quantity: 1 });
    s = step(s);
    s = order(s, { quantity: 2 });
    expect(s.positions.ASTR.cost).toBe(30005);
    s = order(s, { side: "sell", quantity: 1 });
    expect(s.positions.ASTR.cost).toBe(20003);
    s = order(s, { side: "sell", quantity: 2 });
    expect(s.positions.ASTR.cost).toBe(0);
    expect(s.realized).toBe(1);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 101, Number.MAX_SAFE_INTEGER])(
    "rejects invalid quantity %s without account mutation",
    (quantity) => {
      const s = createState();
      const next = order(s, { quantity });
      expect(next.cash).toBe(s.cash);
      expect(next.orders).toEqual([]);
      expect(next.notice.tone).toBe("error");
    },
  );
  it.each([0, -1, 1.1, NaN, Infinity, 1_000_001])(
    "rejects invalid limit cents %s",
    (limit) => {
      const next = order(createState(), { kind: "limit", limit });
      expect(next.orders).toHaveLength(0);
      expect(next.notice.tone).toBe("error");
    },
  );
  it("rejects an invalid symbol, side, type, and market limit payload", () => {
    for (const input of [
      { symbol: "REAL" },
      { side: "short" },
      { kind: "code" },
      { limit: 100 },
    ])
      expect(
        order(createState(), input as Partial<OrderInput>).notice.tone,
      ).toBe("error");
  });
  it("rejects overspending, position overflow and gross exposure overflow", () => {
    expect(
      order(createState(1, tape([1_000_000, 1_000_000])), { quantity: 100 })
        .notice.text,
    ).toContain("cash");
    const start = createState(1, tape([25000, 25000]));
    let s = order(start, { quantity: 100 });
    expect(order(s, { quantity: 1 }).notice.text).toContain("Position risk");
    s = order(s, { symbol: "BRIK", quantity: 100 });
    expect(order(s, { symbol: "COVE", quantity: 41 }).notice.text).toContain(
      "Gross risk",
    );
    expect(account(s).exposure).toBe(5_000_000);
  });
  it("reserves pending buys against cash and caps; cancellation releases resources", () => {
    let s = createState(1, tape([25000, 25000]));
    s = order(s, { kind: "limit", limit: 24000, quantity: 100 });
    expect(account(s).reserved).toBe(2_400_000);
    expect(account(s).available).toBe(7_600_000);
    expect(order(s, { quantity: 1 }).notice.text).toContain("Position risk");
    s = reducer(s, { type: "cancel", id: 1 });
    expect(account(s).reserved).toBe(0);
    expect(s.orders[0].status).toBe("cancelled");
    expect(reducer(s, { type: "cancel", id: 1 })).toBe(s);
  });
  it("prevents shorting and duplicate reservations of shares", () => {
    let s = createState(1, tape([10000, 10000]));
    expect(order(s, { side: "sell" }).notice.text).toContain("shares");
    s = order(s);
    s = order(s, { side: "sell", kind: "limit", limit: 12000, quantity: 7 });
    expect(order(s, { side: "sell", quantity: 4 }).notice.text).toContain(
      "shares",
    );
    expect(
      order(s, { side: "sell", quantity: 3 }).positions.ASTR.quantity,
    ).toBe(7);
  });
  it("fills buys and sells at first crossing, at observed price with price improvement", () => {
    let s = order(createState(1, tape([10000, 9500, 9000, 10500])), {
      kind: "limit",
      limit: 9600,
    });
    expect(s.orders[0].status).toBe("open");
    s = step(s);
    expect(s.orders[0].fillPrice).toBe(9500);
    s = order(s, { side: "sell", kind: "limit", limit: 10000 });
    s = step(s);
    expect(s.orders[1].status).toBe("open");
    s = step(s);
    expect(s.orders[1].fillPrice).toBe(10500);
    expect(s.realized).toBe(10000);
  });
  it("fills a marketable limit immediately and preserves original submission time", () => {
    const s = order(createState(1, tape([10000, 9900])), {
      kind: "limit",
      limit: 10100,
    });
    expect(s.orders[0].fillPrice).toBe(10000);
    expect(s.orders[0].filledAt).toBe(s.tape[0].timestamp);
  });
  it("rejects a triggered limit if price drift makes aggregate risk exceed a cap", () => {
    let s = order(createState(1, tape([20000, 30000, 19000])), {
      quantity: 100,
    });
    s = order(s, { symbol: "BRIK", quantity: 100 });
    s = order(s, {
      symbol: "COVE",
      kind: "limit",
      limit: 19500,
      quantity: 100,
    });
    expect(s.orders[2].status).toBe("open");
    // BRIK remains elevated while COVE crosses its limit.
    const custom = s.tape.map((f, i) =>
      i === 2 ? { ...f, prices: { ...f.prices, ASTR: 30000, BRIK: 30000 } } : f,
    );
    s = advance({ ...s, tape: custom }, 2);
    expect(s.orders[2].status).toBe("rejected");
    expect(s.cash).toBe(6_000_000);
  });
  it("bounds orders while preserving complete accounting and stable IDs", () => {
    let s = createState(1, tape([100, 100]));
    for (let i = 0; i < CAPS.orders; i++)
      s = order(s, { quantity: 1, side: i % 2 ? "sell" : "buy" });
    expect(s.orders).toHaveLength(200);
    expect(s.orders[199].id).toBe(200);
    expect(s.cash).toBe(INITIAL_CASH);
    expect(order(s, { quantity: 1 }).notice.text).toContain(
      "Session order limit",
    );
  });
  it("keeps integer accounting identities throughout a mixed replay", () => {
    let s = createState();
    for (let i = 0; i < 150; i++) {
      s = step(s);
      if (i % 6 === 0) s = order(s, { quantity: 1, symbol: "COVE" });
      if (i % 11 === 0 && s.positions.COVE.quantity)
        s = order(s, { quantity: 1, symbol: "COVE", side: "sell" });
      const a = account(s);
      expect(Number.isSafeInteger(s.cash)).toBe(true);
      expect(s.cash).toBeGreaterThanOrEqual(0);
      expect(a.equity - INITIAL_CASH).toBe(s.realized + a.unrealized);
    }
  });
  it("parses decimal dollars without accepting exponent, nonfinite or excess precision", () => {
    expect(parsePrice("123.45")).toBe(12345);
    expect(parsePrice("0.01")).toBe(1);
    expect(parsePrice("1.2")).toBe(120);
    for (const p of ["NaN", "Infinity", "1e2", "-1", "2.001", "", "=2+2"])
      expect(parsePrice(p)).toBeNaN();
  });
});

describe("CSV contract and safe exports", () => {
  const valid = exportReplay(tape([10000, 11000]));
  it("round trips exact synthetic data with BOM and CRLF support", () => {
    expect(parseReplayCsv(valid)).toEqual(tape([10000, 11000]));
    expect(parseReplayCsv("\uFEFF" + valid.replaceAll("\n", "\r\n"))).toEqual(
      tape([10000, 11000]),
    );
    expect(parseReplayCsv(exportReplay(generateTape()))).toEqual(
      generateTape(),
    );
  });
  it("rejects oversized bytes and too many rows separately", () => {
    expect(() => parseReplayCsv("x".repeat(MAX_BYTES + 1))).toThrow("512 KiB");
    const row = "2026-01-12T09:30:00.000Z,ASTR,1,0\n";
    expect(() => parseReplayCsv(CSV_HEADER + "\n" + row.repeat(4001))).toThrow(
      "Too many rows",
    );
  });
  it.each([
    ["header", (s: string) => s.replace("price_cents", "price")],
    [
      "duplicate",
      (s: string) =>
        s.replace("2026-01-12T09:30:05.000Z", "2026-01-12T09:30:00.000Z"),
    ],
    ["symbol order", (s: string) => s.replace("ASTR", "BRIK")],
    ["unknown symbol", (s: string) => s.replace("ASTR", "REAL")],
    ["fractional cents", (s: string) => s.replace("10000", "100.1")],
    ["zero cents", (s: string) => s.replace("10000", "0")],
    ["price over bound", (s: string) => s.replace("10000", "1000001")],
    ["unsafe integer", (s: string) => s.replace("10000", "9007199254740992")],
    ["negative volume", (s: string) => s.replace(",500", ",-1")],
    ["volume over bound", (s: string) => s.replace(",500", ",1000001")],
    ["nonfinite volume", (s: string) => s.replace(",500", ",NaN")],
    ["fractional volume", (s: string) => s.replace(",500", ",0.5")],
    ["nonfinite", (s: string) => s.replace("10000", "Infinity")],
    ["exponent", (s: string) => s.replace("10000", "1e4")],
    ["negative", (s: string) => s.replace("10000", "-100")],
    ["invalid date", (s: string) => s.replaceAll("2026-01-12", "2026-02-30")],
    ["formula", (s: string) => s.replace("10000", "=1+1")],
    ["whitespace formula", (s: string) => s.replace("10000", "  @SUM(A1)")],
    [
      "extra fields",
      (s: string) => s.replace(",10000,500", ",10000,500,extra"),
    ],
    ["quoted fields", (s: string) => s.replace("ASTR", '"ASTR"')],
    [
      "incomplete group",
      (s: string) => s.trim().split("\n").slice(0, -1).join("\n"),
    ],
    ["blank rows", (s: string) => s + "\n"],
  ])("rejects %s", (_, mutate) => {
    expect(() => parseReplayCsv(mutate(valid))).toThrow();
  });
  it("rejects backward timestamps and mismatched symbol groups", () => {
    const reversed = exportReplay([...tape([100, 200])].reverse());
    expect(() => parseReplayCsv(reversed)).toThrow("strictly increase");
    expect(() =>
      parseReplayCsv(
        valid.replace(
          "2026-01-12T09:30:00.000Z,BRIK",
          "2026-01-12T09:30:01.000Z,BRIK",
        ),
      ),
    ).toThrow("all four");
  });
  it("neutralizes formula prefixes and quotes multiline/comma/quote content", () => {
    for (const s of [
      "=SUM(A1)",
      "+1",
      "-1",
      "@evil",
      "  =1",
      "\t=1",
      "\r@evil",
      "\n+cmd",
    ])
      expect(safeCell(s).startsWith("\"'")).toBe(true);
    expect(safeCell('hello,"world"\n')).toBe('"hello,""world""\n"');
    const s = order(createState());
    const csv = exportLedger([{ ...s.orders[0], reason: "=malicious()" }]);
    expect(csv).toContain('"\'=malicious()"');
    expect(exportLedger([])).toContain("id,timestamp,symbol");
  });
});

describe("versioned persistence with journal reconstruction", () => {
  it("restores fills, limits, cancellation, cash, positions and cursor; always paused", () => {
    let s = order(createState());
    s = advance(s, 8);
    s = order(s, { kind: "limit", limit: 100 });
    s = reducer(s, { type: "cancel", id: 2 });
    s = order(s, { side: "sell", quantity: 3 });
    s = advance(s, 4);
    const restored = deserialize(serialize({ ...s, running: true }));
    expect(restored.cash).toBe(s.cash);
    expect(restored.realized).toBe(s.realized);
    expect(restored.positions).toEqual(s.positions);
    expect(restored.orders).toEqual(s.orders);
    expect(restored.cursor).toBe(s.cursor);
    expect(restored.running).toBe(false);
  });
  it("reconstructs imported tapes and pending fills", () => {
    let s = order(createState(1, tape([10000, 9000, 11000])), {
      kind: "limit",
      limit: 9500,
    });
    s = advance(s, 2);
    expect(deserialize(serialize(s)).orders).toEqual(s.orders);
    expect(deserialize(serialize(s)).cash).toBe(s.cash);
  });
  it("rejects malformed, oversized, unknown versions, invalid cursor and forged journal events", () => {
    const good = JSON.parse(serialize(createState()));
    for (const raw of [
      "{",
      "null",
      "x".repeat(900001),
      JSON.stringify({ ...good, version: 2 }),
      JSON.stringify({ ...good, cursor: Infinity }),
      JSON.stringify({
        ...good,
        journal: [
          {
            cursor: 59,
            type: "order",
            input: {
              symbol: "ASTR",
              side: "buy",
              kind: "market",
              quantity: 100000,
              limit: null,
            },
          },
        ],
      }),
      JSON.stringify({
        ...good,
        journal: [{ cursor: 58, type: "cancel", id: 1 }],
      }),
    ])
      expect(() => deserialize(raw)).toThrow();
  });
});
