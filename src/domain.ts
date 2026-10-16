export const ASSETS = [
  { symbol: "ASTR", name: "Aster Systems", sector: "Technology", base: 18432 },
  {
    symbol: "BRIK",
    name: "Brickline Industries",
    sector: "Industrials",
    base: 9275,
  },
  { symbol: "COVE", name: "Cove Energy", sector: "Energy", base: 6418 },
  { symbol: "VOLT", name: "Volt Mobility", sector: "Transport", base: 24760 },
] as const;
export type Symbol = (typeof ASSETS)[number]["symbol"];
export const SYMBOLS = ASSETS.map((a) => a.symbol);
export const INITIAL_CASH = 10_000_000;
export const CAPS = {
  orderShares: 100,
  position: 2_500_000,
  gross: 6_000_000,
  orders: 200,
} as const;
export const DEFAULT_SEED = 73129;
export const MAX_FRAMES = 1000;
export const MAX_PRICE = 1_000_000;
export const BASE_TIME = Date.UTC(2026, 0, 12, 9, 30);
export interface Frame {
  timestamp: string;
  prices: Record<Symbol, number>;
  volumes: Record<Symbol, number>;
}
export interface Position {
  quantity: number;
  cost: number;
}
export interface OrderInput {
  symbol: Symbol;
  side: "buy" | "sell";
  kind: "market" | "limit";
  quantity: number;
  limit: number | null;
}
export interface Order extends OrderInput {
  id: number;
  timestamp: string;
  status: "open" | "filled" | "cancelled" | "rejected";
  fillPrice: number | null;
  filledAt: string | null;
  reason: string;
}
export type JournalEvent =
  | { cursor: number; type: "order"; input: OrderInput }
  | { cursor: number; type: "cancel"; id: number };
export interface State {
  seed: number;
  source: "seeded" | "imported";
  tape: Frame[];
  start: number;
  cursor: number;
  cash: number;
  realized: number;
  positions: Record<Symbol, Position>;
  orders: Order[];
  journal: JournalEvent[];
  running: boolean;
  speed: number;
  notice: { tone: "info" | "error" | "success"; text: string };
}
export type Action =
  | { type: "step" }
  | { type: "toggle" }
  | { type: "speed"; value: number }
  | { type: "reset"; seed?: number }
  | { type: "order"; input: OrderInput }
  | { type: "cancel"; id: number }
  | { type: "import"; tape: Frame[] }
  | { type: "notice"; tone: State["notice"]["tone"]; text: string };
export const records = <T>(make: (symbol: Symbol) => T): Record<Symbol, T> =>
  Object.fromEntries(SYMBOLS.map((s) => [s, make(s)])) as Record<Symbol, T>;
export const isSymbol = (value: unknown): value is Symbol =>
  SYMBOLS.includes(value as Symbol);
export const integer = (
  value: unknown,
  min: number,
  max: number,
): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;

/** Mulberry32: only integer arithmetic; UTC ticks do not depend on wall clock or timezone. */
export function generateTape(seed = DEFAULT_SEED): Frame[] {
  let value = seed >>> 0;
  const random = () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const prices = records(
    (s) => ASSETS.find((a) => a.symbol === s)!.base as number,
  );
  return Array.from({ length: 660 }, (_, i) => {
    const volumes = records((s) => {
      const trend = Math.sin(i / 28 + SYMBOLS.indexOf(s)) * 0.0007;
      prices[s] = Math.max(
        100,
        Math.round(prices[s] * (1 + trend + (random() - 0.49) * 0.0028)),
      );
      return 100 + Math.floor(random() * 1900);
    });
    return {
      timestamp: new Date(BASE_TIME + i * 5000).toISOString(),
      prices: { ...prices },
      volumes,
    };
  });
}
export function createState(seed = DEFAULT_SEED, tape?: Frame[]): State {
  return {
    seed,
    source: tape ? "imported" : "seeded",
    tape: tape ?? generateTape(seed),
    start: tape ? 0 : 59,
    cursor: tape ? 0 : 59,
    cash: INITIAL_CASH,
    realized: 0,
    positions: records(() => ({ quantity: 0, cost: 0 })),
    orders: [],
    journal: [],
    running: false,
    speed: 1,
    notice: {
      tone: "info",
      text: tape
        ? "Replay imported. Account reset; ready at the first timestamp."
        : "Desk ready. Synthetic session loaded; replay is paused.",
    },
  };
}
export const current = (s: State) => s.tape[s.cursor];
export function account(s: State) {
  const exposure = SYMBOLS.reduce(
    (n, sym) => n + s.positions[sym].quantity * current(s).prices[sym],
    0,
  );
  const cost = SYMBOLS.reduce((n, sym) => n + s.positions[sym].cost, 0);
  const reserved = s.orders
    .filter((o) => o.status === "open" && o.side === "buy")
    .reduce((n, o) => n + o.quantity * o.limit!, 0);
  return {
    exposure,
    equity: s.cash + exposure,
    unrealized: exposure - cost,
    reserved,
    available: s.cash - reserved,
  };
}
function validate(s: State, o: OrderInput, exclude?: number): string | null {
  if (
    !isSymbol(o.symbol) ||
    !["buy", "sell"].includes(o.side) ||
    !["market", "limit"].includes(o.kind)
  )
    return "Invalid symbol, side, or order type.";
  if (!integer(o.quantity, 1, CAPS.orderShares))
    return `Quantity must be a whole number from 1 to ${CAPS.orderShares}.`;
  if (o.kind === "limit" && !integer(o.limit, 1, MAX_PRICE))
    return "Limit price must be $0.01–$10,000.00, with at most two decimals.";
  if (o.kind === "market" && o.limit !== null)
    return "Market orders cannot include a limit price.";
  const pending = s.orders.filter(
    (x) => x.status === "open" && x.id !== exclude,
  );
  const price = o.kind === "limit" ? o.limit! : current(s).prices[o.symbol];
  if (o.side === "sell") {
    const reserved = pending
      .filter((x) => x.symbol === o.symbol && x.side === "sell")
      .reduce((n, x) => n + x.quantity, 0);
    if (o.quantity > s.positions[o.symbol].quantity - reserved)
      return "Insufficient available shares. Short selling is disabled.";
    return null;
  }
  const reservedCash = pending
    .filter((x) => x.side === "buy")
    .reduce((n, x) => n + x.quantity * x.limit!, 0);
  if (o.quantity * price > s.cash - reservedCash)
    return "Insufficient available cash, including open-order reservations.";
  const projected = records(
    (sym) =>
      s.positions[sym].quantity * current(s).prices[sym] +
      pending
        .filter((x) => x.side === "buy" && x.symbol === sym)
        .reduce(
          (n, x) => n + x.quantity * Math.max(current(s).prices[sym], x.limit!),
          0,
        ),
  );
  projected[o.symbol] +=
    o.quantity * Math.max(price, current(s).prices[o.symbol]);
  if (projected[o.symbol] > CAPS.position)
    return "Position risk cap exceeded: $25,000 per symbol, including pending buys.";
  if (SYMBOLS.reduce((n, sym) => n + projected[sym], 0) > CAPS.gross)
    return "Gross risk cap exceeded: $60,000, including pending buys.";
  return null;
}
function fill(s: State, order: Order): State {
  const price = current(s).prices[order.symbol];
  const position = s.positions[order.symbol];
  const notional = price * order.quantity;
  // Allocate integer cost on partial sales; the final sale consumes all remaining basis.
  const removedCost =
    order.side === "sell"
      ? Math.round((position.cost * order.quantity) / position.quantity)
      : 0;
  const updated =
    order.side === "buy"
      ? {
          quantity: position.quantity + order.quantity,
          cost: position.cost + notional,
        }
      : {
          quantity: position.quantity - order.quantity,
          cost: position.cost - removedCost,
        };
  return {
    ...s,
    cash: s.cash + (order.side === "buy" ? -notional : notional),
    realized: s.realized + (order.side === "sell" ? notional - removedCost : 0),
    positions: { ...s.positions, [order.symbol]: updated },
    orders: s.orders.map((o) =>
      o.id === order.id
        ? {
            ...o,
            status: "filled",
            fillPrice: price,
            filledAt: current(s).timestamp,
            reason: "Filled at synthetic last price",
          }
        : o,
    ),
  };
}
const executable = (s: State, o: OrderInput) =>
  o.kind === "market" ||
  (o.side === "buy"
    ? current(s).prices[o.symbol] <= o.limit!
    : current(s).prices[o.symbol] >= o.limit!);
export function step(s: State): State {
  if (s.cursor >= s.tape.length - 1)
    return {
      ...s,
      running: false,
      notice: {
        tone: "info",
        text: "End of replay. Reset to run this session again.",
      },
    };
  let next: State = {
    ...s,
    cursor: s.cursor + 1,
    running: s.running && s.cursor + 1 < s.tape.length - 1,
  };
  for (const order of next.orders.filter((o) => o.status === "open")) {
    if (!executable(next, order)) continue;
    const reason = validate(next, order, order.id);
    if (reason)
      next = {
        ...next,
        orders: next.orders.map((o) =>
          o.id === order.id ? { ...o, status: "rejected", reason } : o,
        ),
        notice: {
          tone: "error",
          text: `Order #${order.id} rejected at fill: ${reason}`,
        },
      };
    else
      next = {
        ...fill(next, order),
        notice: {
          tone: "success",
          text: `Limit #${order.id} filled at ${current(next).timestamp.slice(11, 19)} UTC.`,
        },
      };
  }
  return next;
}
export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "step":
      return step(s);
    case "toggle":
      return { ...s, running: s.cursor < s.tape.length - 1 && !s.running };
    case "speed":
      return [1, 2, 4, 8].includes(a.value) ? { ...s, speed: a.value } : s;
    case "notice":
      return { ...s, notice: { tone: a.tone, text: a.text } };
    case "reset": {
      if (a.seed !== undefined && !integer(a.seed, 0, 0xffffffff))
        return {
          ...s,
          notice: {
            tone: "error",
            text: "Seed must be an integer from 0 to 4294967295.",
          },
        };
      return a.seed === undefined && s.source === "imported"
        ? createState(s.seed, s.tape)
        : createState(a.seed ?? s.seed);
    }
    case "import":
      return createState(s.seed, a.tape);
    case "order": {
      if (s.orders.length >= CAPS.orders)
        return {
          ...s,
          notice: {
            tone: "error",
            text: "Session order limit reached (200). Export the ledger, then reset.",
          },
        };
      const error = validate(s, a.input);
      if (error) return { ...s, notice: { tone: "error", text: error } };
      const order: Order = {
        ...a.input,
        id: s.orders.length + 1,
        timestamp: current(s).timestamp,
        status: "open",
        fillPrice: null,
        filledAt: null,
        reason: "Waiting for limit",
      };
      let next: State = {
        ...s,
        orders: [...s.orders, order],
        journal: [
          ...s.journal,
          { type: "order", cursor: s.cursor, input: { ...a.input } },
        ],
        notice: {
          tone: "success",
          text: `Order #${order.id} accepted. ${executable(s, order) ? "Paper fill complete." : "Limit queued; resources reserved."}`,
        },
      };
      if (executable(next, order)) next = fill(next, order);
      return next;
    }
    case "cancel": {
      if (!s.orders.some((o) => o.id === a.id && o.status === "open")) return s;
      return {
        ...s,
        orders: s.orders.map((o) =>
          o.id === a.id
            ? { ...o, status: "cancelled", reason: "Cancelled by user" }
            : o,
        ),
        journal: [...s.journal, { type: "cancel", id: a.id, cursor: s.cursor }],
        notice: {
          tone: "info",
          text: `Order #${a.id} cancelled. Reservation released.`,
        },
      };
    }
  }
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
export const signedMoney = (cents: number) =>
  `${cents >= 0 ? "+" : "−"}${money(Math.abs(cents))}`;
export function parsePrice(value: string): number {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) return NaN;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
