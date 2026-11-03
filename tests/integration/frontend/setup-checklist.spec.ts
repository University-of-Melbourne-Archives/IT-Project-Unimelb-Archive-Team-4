import { test, expect, type Page } from "@playwright/test";
import { serveItems } from "./items-mock";

// Set up series on a series' Items page, on an intercepted API: nothing reaches the real backend.
type Type = { name: string; label: string; unknown: boolean; templateVersion: number | null };
const UNKNOWN: Type = { name: "unknown_2", label: "Unknown", unknown: true, templateVersion: null };
const LETTER: Type = { name: "letter", label: "Letter", unknown: false, templateVersion: 3 };
const ENVELOPE: Type = { name: "envelope", label: "Envelope", unknown: false, templateVersion: null };
const NEW = {
  id: 2, name: "Letters", recordName: "record", levels: [] as { name: string }[], grouped: false, archiveSeries: 7, archiveItems: 2,
  archiveIdentifier: null, pageTypes: 0, templates: 0, pages: 0, unknownPages: 0, bundles: 0, running: 0,
};

// The series, its page types and its items read, as the test changes them.
async function mock(page: Page) {
  const state = { series: { ...NEW }, types: [UNKNOWN], read: [] as { id: string; name: string }[] };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const served = serveItems([{ bundle: "L1", name: "L1", loaded: false }, { bundle: "L2", name: "L2", loaded: false }], route.request());
    if (served) return route.fulfill(served);
    if (path === "/api/collections/2") return route.fulfill({ json: state.series });
    if (path === "/api/page-types") return route.fulfill({ json: state.types });
    if (path === "/api/export/bundles") return route.fulfill({ json: state.read });
    return route.fulfill({ status: 404, json: { detail: `Unexpected test request: ${path}` } });
  });
  return state;
}

const bar = (page: Page) => page.getByRole("region", { name: /This series isn't set up yet|Reading a sample item|Almost set up/ });
const card = (page: Page) => page.getByRole("region", { name: "Series set up" });
const steps = (page: Page) => card(page).getByRole("list", { name: "Setup steps" }).getByRole("listitem");
const next = (page: Page) => card(page).locator('li[aria-current="step"]'); // the step to do now
const wizard = (page: Page) => bar(page).getByRole("link", { name: "Run the setup wizard" });

test("a new series' Items page says it isn't set up, with the setup wizard to run, and what is left as it gets set up", async ({ page }) => {
  const state = await mock(page);
  await page.goto("/?series=2");
  await expect(bar(page)).toHaveText(/This series isn't set up yet/);
  await expect(wizard(page)).toHaveAttribute("href", "/?series=2&view=setup");
  await expect(card(page)).toHaveCount(0);

  // page types added, one without a template: still the wizard
  Object.assign(state, { types: [UNKNOWN, LETTER, ENVELOPE] });
  Object.assign(state.series, { pageTypes: 2, templates: 1 });
  await page.reload();
  await expect(bar(page)).toHaveText(/This series isn't set up yet/);
  await expect(wizard(page)).toBeVisible();

  // every template written, nothing read yet
  Object.assign(state, { types: [UNKNOWN, LETTER, { ...ENVELOPE, templateVersion: 4 }] });
  Object.assign(state.series, { templates: 2 });
  await page.reload();
  await expect(bar(page)).toHaveText("Almost set up: press Transcribe on one of its items below");
  await expect(wizard(page)).toHaveCount(0);

  // an item read with all its pages waiting as Unknown isn't a sample yet, and another item is being read
  Object.assign(state, { read: [{ id: "L1", name: "L1" }] });
  Object.assign(state.series, { pages: 3, unknownPages: 3, bundles: 1, running: 1 });
  await page.reload();
  await expect(bar(page)).toHaveText("Reading a sample item…");
  await expect(wizard(page)).toHaveCount(0);

  // set up: the sample read, until another item is read
  Object.assign(state.series, { pages: 4, unknownPages: 1, running: 0 });
  await page.reload();
  await expect(card(page).getByRole("heading")).toHaveText("Series set up");
  await expect(bar(page)).toHaveCount(0);
  await expect(card(page)).toContainText("Check the sample came out right, then read the other items.");
  await expect(steps(page).nth(2).getByRole("link", { name: "Check it" })).toHaveAttribute("href", "/?series=2&item=L1");
  Object.assign(state.series, { bundles: 2 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "All items" })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
});

test("the setup wizard button opens the series' Setup", async ({ page }) => {
  await mock(page);
  await page.goto("/?series=2");
  await wizard(page).click();
  await expect(page).toHaveURL(/\?series=2&view=setup$/);
});

test("a series set up says so and marks no step to do", async ({ page }) => {
  const state = await mock(page);
  Object.assign(state, { types: [UNKNOWN, LETTER], read: [{ id: "L1", name: "L1" }] });
  Object.assign(state.series, { pageTypes: 1, templates: 1, pages: 3, unknownPages: 1, bundles: 1 });
  await page.goto("/?series=2");
  await expect(card(page).getByRole("heading")).toHaveText("Series set up");
  await expect(card(page)).not.toContainText("steps done");
  await expect(card(page)).toContainText("Check the sample came out right, then read the other items.");
  await expect(card(page).getByRole("link", { name: "Open setup" })).toHaveCount(0);
  await expect(next(page)).toHaveCount(0);
  await expect(card(page).getByRole("progressbar")).toHaveCount(0);
  await expect(steps(page).nth(2).getByRole("link", { name: "Check it" })).toHaveAttribute("data-variant", "outline");
  await expect(card(page).getByRole("link", { name: "Set levels" })).toHaveAttribute("href", "/?series=2&view=setup&section=levels");
});

test("an older link, with ?collection=, still opens the series", async ({ page }) => {
  await mock(page);
  await page.goto("/?collection=2");
  await expect(bar(page)).toHaveText(/This series isn't set up yet/);
  await expect(wizard(page)).toHaveAttribute("href", "/?series=2&view=setup");
});
