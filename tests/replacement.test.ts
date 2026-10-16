import { describe, expect, it } from "vitest";
import {
  createState,
  records,
  reducer,
  type Action,
  type Frame,
  type State,
} from "../src/domain";
import { exportReplay, parseReplayCsv } from "../src/csv";
import { deserialize, serialize } from "../src/persistence";
import {
  isAltered,
  session,
  sessionReducer,
  type Replacement,
} from "../src/replacement";

const frames: Frame[] = [10000, 9000, 11000].map((price, i) => ({
  timestamp: new Date(Date.UTC(2026, 0, 12, 9, 30, i * 5)).toISOString(),
  prices: records(() => price),
  volumes: records(() => 500),
}));
const trade = (state: State, side: "buy" | "sell", quantity = 10) =>
  reducer(state, {
    type: "order",
    input: { symbol: "ASTR", side, quantity, kind: "market", limit: null },
  });
function populated() {
  let state = trade(createState(), "buy");
  state = reducer(state, { type: "step" });
  state = trade(state, "sell", 4);
  return reducer(state, {
    type: "order",
    input: {
      symbol: "ASTR",
      side: "buy",
      quantity: 2,
      kind: "limit",
      limit: 100,
    },
  });
}
const candidates: [string, Replacement, State][] = [
  [
    "validated import",
    { type: "import", tape: parseReplayCsv(exportReplay(frames)) },
    createState(undefined, frames),
  ],
  ["seed replacement", { type: "reset", seed: 42 }, createState(42)],
];

describe("destructive session replacement boundary", () => {
  it("protects completed trades even when cash and positions return to their initial values", () => {
    const flat = trade(trade(createState(), "buy"), "sell");
    expect(flat.positions.ASTR.quantity).toBe(0);
    expect(flat.cash).toBe(createState().cash);
    expect(isAltered(flat)).toBe(true);
    for (const [, replacement] of candidates) {
      const waiting = sessionReducer(session(flat), replacement);
      expect(waiting.pending).toEqual(replacement);
      expect(waiting.current).toBe(flat);
    }
  });
  it.each([
    ["replay progress", reducer(createState(), { type: "step" })],
    ["running replay", reducer(createState(), { type: "toggle" })],
    ["playback speed", reducer(createState(), { type: "speed", value: 4 })],
    ["custom seed", createState(42)],
    ["imported dataset", createState(undefined, frames)],
    [
      "cancelled order history",
      reducer(
        reducer(createState(), {
          type: "order",
          input: {
            symbol: "ASTR",
            side: "buy",
            kind: "limit",
            quantity: 1,
            limit: 100,
          },
        }),
        { type: "cancel", id: 1 },
      ),
    ],
  ])(
    "recognizes %s without relying on a nonzero current position",
    (_, state) => {
      expect(isAltered(state)).toBe(true);
    },
  );
  it.each(candidates)(
    "stages %s without changing full state or its persisted representation",
    (_, replacement) => {
      const current = populated(),
        snapshot = structuredClone(current),
        saved = serialize(current);
      const waiting = sessionReducer(session(current), replacement);
      expect(waiting.current).toBe(current);
      expect(waiting.current).toEqual(snapshot);
      expect(serialize(waiting.current)).toBe(saved);
      expect(waiting.pending).toEqual(replacement);
      const blocked: Action[] = [
        { type: "step" },
        { type: "toggle" },
        { type: "speed", value: 8 },
        { type: "reset" },
        { type: "cancel", id: 3 },
        { type: "notice", tone: "error", text: "queued" },
      ];
      for (const action of blocked)
        expect(sessionReducer(waiting, action)).toBe(waiting);
      expect(sessionReducer(waiting, replacement)).toBe(waiting);
    },
  );
  it.each(candidates)(
    "cancels %s with identity-preserved account, engine, data, history and saved state",
    (_, replacement) => {
      const current = reducer(reducer(populated(), { type: "toggle" }), {
          type: "speed",
          value: 8,
        }),
        saved = serialize(current);
      const cancelled = sessionReducer(
        sessionReducer(session(current), replacement),
        { type: "cancel-replacement" },
      );
      expect(cancelled).toEqual(session(current));
      expect(cancelled.current).toBe(current);
      expect(serialize(cancelled.current)).toBe(saved);
    },
  );
  it.each(candidates)(
    "accepts %s as one consistent replacement and reconstructs it from persistence",
    (_, replacement, expected) => {
      const waiting = sessionReducer(session(populated()), replacement);
      const accepted = sessionReducer(waiting, { type: "confirm-replacement" });
      expect(accepted).toEqual(session(expected));
      expect(serialize(deserialize(serialize(accepted.current)))).toBe(
        serialize(expected),
      );
      expect(sessionReducer(accepted, { type: "confirm-replacement" })).toBe(
        accepted,
      );
    },
  );
  it.each(candidates)(
    "allows %s directly on the untouched default desk",
    (_, replacement, expected) => {
      expect(isAltered(createState())).toBe(false);
      expect(sessionReducer(session(createState()), replacement)).toEqual(
        session(expected),
      );
    },
  );
  it("holds a running account during validation; failed CSV cannot mutate it or persistence", () => {
    const current = reducer(populated(), { type: "toggle" }),
      saved = serialize(current);
    const validating = sessionReducer(session(current), {
      type: "begin-import-validation",
    });
    expect(validating.current).toBe(current);
    expect(sessionReducer(validating, { type: "step" })).toBe(validating);
    expect(() => parseReplayCsv("invalid file")).toThrow();
    const rejected = sessionReducer(validating, {
      type: "finish-import-validation",
    });
    expect(rejected).toEqual(session(current));
    expect(serialize(rejected.current)).toBe(saved);
    const waiting = sessionReducer(validating, candidates[0][1]);
    expect(waiting.validating).toBe(false);
    expect(waiting.current.running).toBe(true);
    expect(waiting.current).toBe(current);
  });
  it("rejects invalid seeds and leaves the existing normal reset transition intact", () => {
    const model = session(populated());
    expect(sessionReducer(model, { type: "reset", seed: NaN })).toBe(model);
    expect(sessionReducer(model, { type: "reset" })).toEqual(
      session(reducer(model.current, { type: "reset" })),
    );
  });
});
