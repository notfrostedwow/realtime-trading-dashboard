import { expect, test, type Page } from "@playwright/test";
import {
  createState,
  current,
  money,
  records,
  type Frame,
} from "../../src/domain";
import { exportReplay } from "../../src/csv";
import { deserialize, serialize, STORAGE_KEY } from "../../src/persistence";

const frames: Frame[] = [10000, 9000, 11000].map((price, i) => ({
  timestamp: new Date(Date.UTC(2026, 0, 12, 9, 30, i * 5)).toISOString(),
  prices: records(() => price),
  volumes: records(() => 500),
}));
const csv = exportReplay(frames);
const modal = (page: Page) =>
  page.getByRole("dialog", { name: "Replace this session?", exact: true });
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
async function upload(page: Page, text: string) {
  await page
    .getByLabel("Import replay CSV file")
    .setInputFiles({
      name: "synthetic-replacement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(text),
    });
}
async function snapshot(page: Page) {
  return page.evaluate((key) => {
    const main = document.querySelector("main")!;
    return {
      saved: localStorage.getItem(key),
      text: main.innerText,
      controls: [
        ...main.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          "input,select",
        ),
      ].map((input) => ({
        label: input.getAttribute("aria-label"),
        value: input.value,
      })),
    };
  }, STORAGE_KEY);
}
async function populated(page: Page) {
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await page.getByRole("button", { name: "Step one tick" }).click();
  await page.getByRole("button", { name: "Sell / close" }).click();
  await page.getByLabel("Order quantity").fill("4");
  await page.getByRole("button", { name: "Place paper sell" }).click();
  await page.getByRole("button", { name: "Buy / long" }).click();
  await page.getByLabel("Order type").selectOption("limit");
  await page.getByLabel("Order quantity").fill("2");
  await page.getByLabel("Limit price").fill("1.00");
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await page.getByRole("tab", { name: "Execution ledger 3" }).click();
  await page.getByLabel("Replay speed").selectOption("4");
  await page.getByText("CSV contract & session seed", { exact: true }).click();
  await page.getByLabel("Session seed").fill("42");
  await expect
    .poll(async () => JSON.parse((await saved(page))!).journal.length)
    .toBe(3);
}
async function request(page: Page, kind: "import" | "seed") {
  if (kind === "import") await upload(page, csv);
  else
    await page
      .getByRole("button", { name: "Load seed & reset", exact: true })
      .click();
  await expect(modal(page)).toBeVisible();
  await expect(
    modal(page).getByRole("button", {
      name: "Keep current session",
      exact: true,
    }),
  ).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

for (const kind of ["import", "seed"] as const) {
  test(`${kind}: safe initial focus, keyboard cancel, Escape, atomic acceptance and reload`, async ({
    page,
  }, info) => {
    await populated(page);
    const before = await snapshot(page);
    const account = deserialize(before.saved!);
    expect(account.positions.ASTR.quantity).toBe(6);
    expect(
      account.orders.filter((order) => order.status === "open"),
    ).toHaveLength(1);
    expect(account.orders).toHaveLength(3);

    await request(page, kind);
    await expect(modal(page)).toHaveAttribute(
      "aria-describedby",
      "replacement-description",
    );
    await page.waitForTimeout(200);
    expect(await snapshot(page)).toEqual(before);
    // The first Enter chooses the safe action, not replacement.
    await page.keyboard.press("Enter");
    await expect(modal(page)).not.toBeVisible();
    expect(await snapshot(page)).toEqual(before);

    await request(page, kind);
    await page.keyboard.press("Escape");
    await expect(modal(page)).not.toBeVisible();
    expect(await snapshot(page)).toEqual(before);
    if (kind === "seed")
      await expect(
        page.getByRole("button", { name: "Load seed & reset", exact: true }),
      ).toBeFocused();

    await request(page, kind);
    expect(await snapshot(page)).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/repair-${info.project.name}-${kind}-confirmation.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Tab");
    const accept = modal(page).getByRole("button", {
      name:
        kind === "import" ? "Import replay & replace" : "Load seed & replace",
      exact: true,
    });
    await expect(accept).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(modal(page)).not.toBeVisible();

    const expected =
      kind === "import" ? createState(undefined, frames) : createState(42);
    await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
    await expect(page.getByTestId("equity")).toHaveText("$100,000.00");
    await expect(page.getByTestId("unrealized")).toHaveText("+$0.00");
    await expect(page.getByTestId("tick-count")).toHaveText(
      kind === "import" ? "0 / 2 ticks" : "0 / 600 ticks",
    );
    await expect(page.getByTestId("replay-time")).toHaveText(
      current(expected).timestamp.slice(11, 19),
    );
    await expect(page.locator(".instrument-price>strong")).toHaveText(
      money(current(expected).prices.ASTR),
    );
    await expect(page.getByLabel("Replay speed")).toHaveValue("1");
    await expect(
      page.getByRole("tab", { name: "Execution ledger 0" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Positions 0" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Open orders 0" }),
    ).toBeVisible();
    // Reload before waiting for the debounced save: pagehide must flush the accepted replacement.
    await page.reload();
    await expect(page.getByRole("status")).toContainText("restored and paused");
    await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
    await expect(page.getByTestId("replay-time")).toHaveText(
      current(expected).timestamp.slice(11, 19),
    );
    expect(serialize(deserialize((await saved(page))!))).toBe(
      serialize(expected),
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/screenshots/repair-${info.project.name}-${kind}-accepted.png`,
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("closed trades still protect both replacements; normal Reset retains its confirmation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Place paper buy" }).click();
  await page.getByRole("button", { name: "Sell / close" }).click();
  await page.getByRole("button", { name: "Place paper sell" }).click();
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
  await expect(page.getByRole("tab", { name: "Positions 0" })).toBeVisible();
  await page.getByRole("tab", { name: "Execution ledger 2" }).click();
  await page.getByText("CSV contract & session seed", { exact: true }).click();
  await page.getByLabel("Session seed").fill("42");
  await expect
    .poll(async () => JSON.parse((await saved(page))!).journal.length)
    .toBe(2);
  const before = await snapshot(page);
  for (const kind of ["import", "seed"] as const) {
    await request(page, kind);
    await page.keyboard.press("Escape");
    await expect(modal(page)).not.toBeVisible();
    expect(await snapshot(page)).toEqual(before);
  }
  await page.getByRole("button", { name: "↺ Reset", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Reset this session?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep session", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});

test("invalid replacements leave the account and storage untouched; running replay is held during CSV validation and confirmation", async ({
  page,
}) => {
  await populated(page);
  const baseline = (await snapshot(page)).saved;
  await upload(page, csv.replace("10000", "=1+1"));
  await expect(page.getByRole("alert")).toContainText("formulas");
  await expect(modal(page)).not.toBeVisible();
  expect(await saved(page)).toBe(baseline);
  await page.getByLabel("Session seed").fill("Infinity");
  await page
    .getByRole("button", { name: "Load seed & reset", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Seed must be an integer",
  );
  expect(await saved(page)).toBe(baseline);
  await expect(
    page.getByRole("tab", { name: "Execution ledger 3" }),
  ).toBeVisible();
  await page.getByLabel("Session seed").fill("42");
  const withError = await snapshot(page);
  for (const kind of ["import", "seed"] as const) {
    await request(page, kind);
    await page.keyboard.press("Escape");
    await expect(modal(page)).not.toBeVisible();
    expect(await snapshot(page)).toEqual(withError);
  }

  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return original.call(this);
    };
  });
  await page.getByLabel("Replay speed").selectOption("1");
  await page.getByRole("button", { name: "Play replay" }).click();
  const time = await page.getByTestId("replay-time").textContent();
  await upload(page, csv);
  await expect(
    page.getByRole("button", { name: "Validating…", exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("replay-time")).toHaveText(time!);
  expect(await saved(page)).toBe(baseline);
  await expect(modal(page)).toBeVisible();
  await expect(
    modal(page).getByRole("button", {
      name: "Keep current session",
      exact: true,
    }),
  ).toBeFocused();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("replay-time")).toHaveText(time!);
  expect(await saved(page)).toBe(baseline);
  await page.keyboard.press("Escape");
  await expect(modal(page)).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause replay" }),
  ).toBeVisible();
  await expect(page.getByTestId("replay-time")).toHaveText(time!);
  await expect
    .poll(() => page.getByTestId("replay-time").textContent())
    .not.toBe(time);
  await page.getByRole("button", { name: "Pause replay" }).click();
});
