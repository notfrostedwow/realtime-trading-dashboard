import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exportReplay } from "../../src/csv";
import { records, type Frame } from "../../src/domain";
import { STORAGE_KEY } from "../../src/persistence";

const frames: Frame[] = [10000, 9000, 11000].map((price, i) => ({
  timestamp: new Date(Date.UTC(2026, 0, 12, 9, 30, i * 5)).toISOString(),
  prices: records(() => price),
  volumes: records(() => 500),
}));
const csv = exportReplay(frames);
async function upload(page: Page, content: string) {
  await page.getByLabel("Import replay CSV file").setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
}
async function reset(page: Page) {
  await page.getByRole("button", { name: "↺ Reset", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset session", exact: true })
    .click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("replay controls, chart access, seed, invalid orders, risk rejection and consistent reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByText("DEMO · SYNTHETIC DATA")).toBeVisible();
  await expect(page.getByTestId("tick-count")).toHaveText("0 / 600 ticks");
  await page.getByRole("button", { name: "Step one tick" }).click();
  await expect(page.getByTestId("replay-time")).toHaveText("09:35:00");
  await page.getByLabel("Replay speed").selectOption("8");
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect
    .poll(async () =>
      parseInt((await page.getByTestId("tick-count").textContent())!),
    )
    .toBeGreaterThan(3);
  await page.getByRole("button", { name: "Pause replay" }).click();
  const paused = await page.getByTestId("tick-count").textContent();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("tick-count")).toHaveText(paused!);
  await page.getByRole("button", { name: "1 min", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /ASTR synthetic price, last 12/ }),
  ).toBeVisible();
  await page.getByLabel("Inspect chart tick").focus();
  await page.keyboard.press("Home");
  await expect(page.getByLabel("Inspect chart tick")).toHaveValue("0");
  await page.getByText("Accessible price table", { exact: false }).click();
  await expect(
    page.getByRole("table", { name: "Visible ASTR chart data" }),
  ).toBeVisible();
  await page.getByText("Accessible price table", { exact: false }).click();
  await page.getByLabel("Order quantity").fill("NaN");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await expect(page.getByRole("alert")).toContainText("whole number");
  await page.getByLabel("Order quantity").fill("100");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await expect(page.getByRole("status")).toContainText("accepted");
  await page.getByLabel("Order quantity").fill("40");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await expect(page.getByRole("alert")).toContainText("Position risk cap");
  await page.getByRole("button", { name: "Sell / close" }).click();
  await page.getByLabel("Order quantity").fill("101");
  await page.getByRole("button", { name: "Place paper sell" }).click();
  await expect(page.getByRole("alert")).toContainText("whole number");
  await reset(page);
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
  await expect(page.getByTestId("unrealized")).toHaveText("+$0.00");
  await expect(page.getByTestId("tick-count")).toHaveText("0 / 600 ticks");
  await page.getByRole("tab", { name: "Execution ledger 0" }).click();
  await expect(page.getByText("A clean execution record.")).toBeVisible();
  await page.getByRole("tab", { name: "Execution ledger 0" }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Positions 0" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Positions 0" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByText("CSV contract & session seed", { exact: true }).click();
  await page.getByLabel("Session seed").fill("42");
  await page.getByRole("button", { name: "Load seed & reset" }).click();
  await expect(page.getByRole("status")).toContainText("Desk ready");
  const price = await page.locator(".instrument-price>strong").textContent();
  await page.getByRole("button", { name: "Step one tick" }).click();
  await reset(page);
  await expect(page.locator(".instrument-price>strong")).toHaveText(price!);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("CSV validation, export round trip, limit fills, cash math, cancellation, and persistence", async ({
  page,
}) => {
  await upload(page, "timestamp,symbol,price_cents,volume\n=bad,ASTR,100,1");
  await expect(page.getByRole("alert")).toContainText("At least");
  await upload(page, csv.replace("10000", "=1+1"));
  await expect(page.getByRole("alert")).toContainText("formulas");
  await upload(page, "x".repeat(512 * 1024 + 1));
  await expect(page.getByRole("alert")).toContainText("512 KiB");
  await upload(page, csv);
  await expect(page.getByRole("status")).toContainText("Replay imported");
  await expect(page.getByTestId("replay-time")).toHaveText("09:30:00");
  await page.getByLabel("Order type").selectOption("limit");
  await page.getByLabel("Limit price").fill("95.001");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await expect(page.getByRole("alert")).toContainText("Limit price");
  await page.getByLabel("Limit price").fill("95.00");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await expect(page.getByTestId("cash")).toHaveText("$99,050.00");
  await page.getByRole("tab", { name: "Open orders 1" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel order 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Step one tick" }).click();
  await expect(page.getByTestId("cash")).toHaveText("$99,100.00");
  await page.getByRole("button", { name: "Step one tick" }).click();
  await expect(page.getByTestId("unrealized")).toHaveText("+$200.00");
  await page.getByRole("button", { name: "Sell / close" }).click();
  await page.getByLabel("Order type").selectOption("market");
  await page.getByLabel("Order quantity").fill("4");
  await page.getByRole("button", { name: "Place paper sell" }).click();
  await expect(page.getByTestId("cash")).toHaveText("$99,540.00");
  await expect(page.getByTestId("equity")).toHaveText("$100,200.00");
  await expect(page.locator(".blotter-footer")).toContainText("+$80.00");
  await page.getByRole("button", { name: "Buy / long" }).click();
  await page.getByLabel("Order type").selectOption("limit");
  await page.getByLabel("Order quantity").fill("1");
  await page.getByLabel("Limit price").fill("50.00");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await page.getByRole("tab", { name: "Open orders 1" }).click();
  await page.getByRole("button", { name: "Cancel order 3" }).click();
  await expect(page.getByTestId("cash")).toHaveText("$99,540.00");
  await expect
    .poll(async () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).journal.length,
        STORAGE_KEY,
      ),
    )
    .toBe(4);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("restored and paused");
  await expect(page.getByTestId("cash")).toHaveText("$99,540.00");
  await expect(page.getByTestId("equity")).toHaveText("$100,200.00");
  const exported = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "↓ Export replay", exact: true })
    .click();
  const replayDownload = await exported;
  expect(replayDownload.suggestedFilename()).toBe("signal-foundry-replay.csv");
  expect(await readFile((await replayDownload.path())!, "utf8")).toBe(csv);
  const ledgerExport = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export ledger", exact: false })
    .click();
  const ledger = await ledgerExport;
  const text = await readFile((await ledger.path())!, "utf8");
  expect(text).toContain('"filled"');
  expect(text).toContain('"cancelled"');
  expect(text).toContain('"9000"');
  await upload(page, await readFile((await replayDownload.path())!, "utf8"));
  await page
    .getByRole("button", { name: "Import replay & replace", exact: true })
    .click();
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
  await expect(page.getByTestId("tick-count")).toHaveText("0 / 2 ticks");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await reset(page);
  await expect(page.getByTestId("tick-count")).toHaveText("0 / 2 ticks");
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
});

test("malformed local state recovers and the desk runs without outbound network", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "{broken"),
    STORAGE_KEY,
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "clean paused session was recovered",
  );
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
  const outbound: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      outbound.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.reload();
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Step one tick" }).click();
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await expect(page.getByRole("status")).toContainText("accepted");
  expect(outbound).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("storage failures are visible and an immediate reload preserves the latest order", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await page.reload();
  await expect(page.getByTestId("cash")).toHaveText("$98,087.90");
  await expect(page.getByRole("tab", { name: "Positions 1" })).toBeVisible();
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage disabled");
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText("Local storage is unavailable or full.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await expect(page.getByTestId("cash")).toHaveText("$98,087.90");
  await reset(page);
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
});

test("captures a real populated workbench with usable desktop and mobile layouts", async ({
  page,
}, info) => {
  await page.getByLabel("Order quantity").fill("35");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await page
    .getByRole("button", { name: "Select BRIK, Brickline Industries" })
    .click();
  await page.getByLabel("Order quantity").fill("60");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await page.getByRole("button", { name: "Select COVE, Cove Energy" }).click();
  await page.getByLabel("Order quantity").fill("80");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  for (let i = 0; i < 36; i++)
    await page.getByRole("button", { name: "Step one tick" }).click();
  await page
    .getByRole("button", { name: "Select ASTR, Aster Systems" })
    .click();
  await page.getByLabel("Order quantity").fill("10");
  await page.getByRole("button", { name: "10 min", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Paper positions", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `docs/screenshots/${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.screenshot({
    path: `docs/screenshots/${info.project.name}-viewport.png`,
    fullPage: false,
    animations: "disabled",
  });
});
