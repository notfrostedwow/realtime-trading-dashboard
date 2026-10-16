import {
  integer,
  isSymbol,
  MAX_FRAMES,
  MAX_PRICE,
  records,
  SYMBOLS,
  type Frame,
  type Order,
} from "./domain";
export const CSV_HEADER = "timestamp,symbol,price_cents,volume";
export const MAX_BYTES = 512 * 1024;
export const MAX_ROWS = MAX_FRAMES * SYMBOLS.length;
const fail = (text: string): never => {
  throw new Error(text);
};
/** Intentionally narrow unquoted CSV: no free text, formulas, or executable content. */
export function parseReplayCsv(text: string): Frame[] {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    fail("File exceeds 512 KiB.");
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = clean.endsWith("\n")
    ? clean.slice(0, -1).split("\n")
    : clean.split("\n");
  if (lines[0] !== CSV_HEADER) fail(`Exact header required: ${CSV_HEADER}`);
  if (lines.length - 1 > MAX_ROWS) fail(`Too many rows; maximum ${MAX_ROWS}.`);
  if (lines.length < 9)
    fail("At least two complete timestamps (8 rows) are required.");
  const frames: Frame[] = [];
  let previousTime = -1;
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i += SYMBOLS.length) {
    const frame: Frame = {
      timestamp: "",
      prices: records(() => 0),
      volumes: records(() => 0),
    };
    for (let j = 0; j < SYMBOLS.length; j++) {
      const row = i + j;
      const fields = lines[row]?.split(",");
      if (!fields || fields.length !== 4)
        fail(
          `Row ${row + 1}: expected exactly four unquoted fields and a complete symbol group.`,
        );
      const [timestamp, symbol, rawPrice, rawVolume] = fields;
      if (fields.some((f) => /^[\s]*[=+\-@\t\r]/.test(f)))
        fail(
          `Row ${row + 1}: formulas, signs, and control prefixes are not allowed.`,
        );
      const time = Date.parse(timestamp);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
        !Number.isFinite(time) ||
        new Date(time).toISOString() !== timestamp ||
        time < Date.UTC(2020, 0, 1) ||
        time >= Date.UTC(2100, 0, 1)
      )
        fail(
          `Row ${row + 1}: timestamp must be valid canonical UTC ISO (2020–2099).`,
        );
      if (!isSymbol(symbol)) fail(`Row ${row + 1}: unknown synthetic symbol.`);
      const key = `${timestamp}/${symbol}`;
      if (seen.has(key))
        fail(`Row ${row + 1}: duplicate timestamp and symbol.`);
      seen.add(key);
      if (symbol !== SYMBOLS[j])
        fail(
          `Row ${row + 1}: symbols must be ordered ASTR, BRIK, COVE, VOLT at every timestamp.`,
        );
      if (j === 0) {
        if (time <= previousTime)
          fail(`Row ${row + 1}: timestamps must strictly increase.`);
        frame.timestamp = timestamp;
        previousTime = time;
      } else if (timestamp !== frame.timestamp)
        fail(`Row ${row + 1}: every timestamp requires all four symbols.`);
      if (
        !/^[0-9]+$/.test(rawPrice) ||
        !integer(Number(rawPrice), 1, MAX_PRICE)
      )
        fail(
          `Row ${row + 1}: price_cents must be an integer from 1 to ${MAX_PRICE}.`,
        );
      if (
        !/^[0-9]+$/.test(rawVolume) ||
        !integer(Number(rawVolume), 0, 1_000_000)
      )
        fail(`Row ${row + 1}: volume must be an integer from 0 to 1000000.`);
      frame.prices[SYMBOLS[j]] = Number(rawPrice);
      frame.volumes[SYMBOLS[j]] = Number(rawVolume);
    }
    frames.push(frame);
  }
  return frames;
}
/** Quote every exported cell; apostrophe-neutralize formula prefixes, even after whitespace. */
export function safeCell(value: string | number): string {
  let cell = String(value);
  if (/^[\s]*[=+\-@]/.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}
export function exportReplay(tape: Frame[]): string {
  // Schema only permits canonical timestamps, fixed symbols, and unsigned integers.
  return `${CSV_HEADER}\n${tape.flatMap((f) => SYMBOLS.map((s) => `${f.timestamp},${s},${f.prices[s]},${f.volumes[s]}`)).join("\n")}\n`;
}
export function exportLedger(orders: Order[]): string {
  return (
    [
      "id,timestamp,symbol,side,type,quantity,limit_cents,status,fill_cents,filled_at,reason",
      ...orders.map((o) =>
        [
          o.id,
          o.timestamp,
          o.symbol,
          o.side,
          o.kind,
          o.quantity,
          o.limit ?? "",
          o.status,
          o.fillPrice ?? "",
          o.filledAt ?? "",
          o.reason,
        ]
          .map(safeCell)
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
