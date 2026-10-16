import {
  DEFAULT_SEED,
  INITIAL_CASH,
  integer,
  reducer,
  SYMBOLS,
  type Action,
  type State,
} from "./domain";

export type Replacement =
  | Extract<Action, { type: "import" }>
  | { type: "reset"; seed: number };
export interface Session {
  current: State;
  pending: Replacement | null;
  validating: boolean;
}
export type SessionAction =
  | Action
  | { type: "begin-import-validation" }
  | { type: "finish-import-validation" }
  | { type: "confirm-replacement" }
  | { type: "cancel-replacement" };

export const session = (current: State): Session => ({
  current,
  pending: null,
  validating: false,
});

/** Protect history and replay configuration even when there are no remaining positions. */
export function isAltered(state: State): boolean {
  return (
    state.source !== "seeded" ||
    state.seed !== DEFAULT_SEED ||
    state.cursor !== state.start ||
    state.running ||
    state.speed !== 1 ||
    state.cash !== INITIAL_CASH ||
    state.realized !== 0 ||
    state.orders.length > 0 ||
    state.journal.length > 0 ||
    SYMBOLS.some(
      (symbol) =>
        state.positions[symbol].quantity !== 0 ||
        state.positions[symbol].cost !== 0,
    )
  );
}

/** Pending replacements and validation are transient; only current is persisted. */
export function sessionReducer(model: Session, action: SessionAction): Session {
  if (action.type === "cancel-replacement")
    return model.pending ? { ...model, pending: null } : model;
  if (action.type === "confirm-replacement")
    return model.pending
      ? session(reducer(model.current, model.pending))
      : model;
  if (action.type === "finish-import-validation")
    return model.validating ? { ...model, validating: false } : model;
  if (model.pending) return model;
  if (action.type === "begin-import-validation")
    return { ...model, validating: true };
  // Imports arrive only after full CSV validation. Queued replay/order actions cannot
  // change the account during that asynchronous read, including on a failed import.
  if (model.validating && action.type !== "import") return model;
  if (
    action.type === "import" ||
    (action.type === "reset" && action.seed !== undefined)
  ) {
    if (action.type === "reset" && !integer(action.seed, 0, 0xffffffff))
      return model;
    const replacement = action as Replacement;
    return isAltered(model.current)
      ? { ...model, pending: replacement, validating: false }
      : session(reducer(model.current, replacement));
  }
  const next = reducer(model.current, action);
  return next === model.current ? model : { ...model, current: next };
}
