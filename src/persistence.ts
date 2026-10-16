import {
  createState,
  integer,
  reducer,
  step,
  type JournalEvent,
  type State,
} from "./domain";
import { exportReplay, MAX_BYTES, parseReplayCsv } from "./csv";
export const STORAGE_KEY = "signal-foundry.session.v1";
const MAX_STORAGE = 900_000;
export function serialize(s: State): string {
  return JSON.stringify({
    version: 1,
    seed: s.seed,
    source: s.source,
    csv: s.source === "imported" ? exportReplay(s.tape) : null,
    cursor: s.cursor,
    journal: s.journal,
  });
}
export function deserialize(raw: string): State {
  if (raw.length > MAX_STORAGE) throw new Error("Saved session too large");
  const data = JSON.parse(raw);
  if (
    !data ||
    data.version !== 1 ||
    !integer(data.seed, 0, 0xffffffff) ||
    !["seeded", "imported"].includes(data.source) ||
    !Array.isArray(data.journal) ||
    data.journal.length > 400
  )
    throw new Error("Unsupported saved session");
  if (
    data.source === "imported" &&
    (typeof data.csv !== "string" || data.csv.length > MAX_BYTES)
  )
    throw new Error("Invalid saved replay");
  let s = createState(
    data.seed,
    data.source === "imported" ? parseReplayCsv(data.csv) : undefined,
  );
  if (!integer(data.cursor, s.start, s.tape.length - 1))
    throw new Error("Invalid saved cursor");
  for (const event of data.journal as JournalEvent[]) {
    if (!event || !integer(event.cursor, s.cursor, data.cursor))
      throw new Error("Invalid event order");
    while (s.cursor < event.cursor) s = step(s);
    const length = s.journal.length;
    if (event.type === "order" && event.input)
      s = reducer(s, { type: "order", input: event.input });
    else if (event.type === "cancel" && integer(event.id, 1, 200))
      s = reducer(s, { type: "cancel", id: event.id });
    else throw new Error("Invalid saved event");
    if (s.journal.length !== length + 1)
      throw new Error("Saved event violates account rules");
  }
  while (s.cursor < data.cursor) s = step(s);
  return {
    ...s,
    running: false,
    notice: {
      tone: "info",
      text: "Local session restored and paused. Account verified by replaying its journal.",
    },
  };
}
export function loadSession(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? deserialize(raw) : createState();
  } catch {
    return {
      ...createState(),
      notice: {
        tone: "error",
        text: "Saved session was unreadable or unavailable. A clean paused session was recovered; reset is always available.",
      },
    };
  }
}
