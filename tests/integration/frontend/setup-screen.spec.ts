import { test, expect, type Page } from "@playwright/test";
import { serveItems } from "./items-mock";

// A series' Setup as a whole: how it is opened, its side menu of sections, its overview of a read item, and moving between its
// Items, Accuracy and Setup without loading the page again. Every API call is intercepted: no requests reach the real backend.
const COLLECTION = {
  id: 1, name: "Wilfred Prest Survey", recordName: "survey", grouped: true, archiveSeries: 499420, archiveIdentifier: "UMA-SR-000000842",
  levels: [{ name: "survey", key: "number_of_dwelling", parts: [{ type: "main", count: "one_or_more", how: "starts" }, { type: "notes", count: "any", how: "follows" }] }],
  pageTypes: 2, templates: 2, pages: 5, unknownPages: 0, bundles: 1, running: 0,
};
const DIARIES = { ...COLLECTION, id: 2, name: "Strathfieldsaye Estate Diaries", archiveSeries: 524173, archiveIdentifier: "UMA-SR-000001769" };
const TYPES = [
  { name: "main", label: "Main page", builtIn: true, unknown: false, templateVersion: 7 },
  { name: "notes", label: "Notes page", builtIn: true, unknown: false, templateVersion: 9 },
  { name: "other", label: "Unknown", builtIn: true, unknown: true, templateVersion: null },
];
// A read item: a notes page before any survey, then two surveys of a main page and a notes page each.
const ITEM = {
  bundle: "216412", name: "216412",
  pages: [["216412/p1", "notes", null], ["216412/p2", "main", "216412-3"], ["216412/p3", "notes", "216412-3"],
    ["216412/p4", "main", "216412-7"], ["216412/p5", "notes", "216412-7"]].map(([id, type, surveyId], i) => ({
    id: id!, label: `Pg ${i + 1}`, category: type === "main" ? "Main page" : "Notes page", status: "Ready to review", flagCount: 0, surveyId,
  })),
};

async function mockApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const served = serveItems([ITEM], route.request());
    if (served) return route.fulfill(served);
    if (path === "/api/reviewers") return route.fulfill({ json: [{ id: 1, name: "Ben" }] });
    if (path === "/api/collections/1") return route.fulfill({ json: COLLECTION });
    if (path === "/api/collections/2") return route.fulfill({ json: DIARIES });
    if (path === "/api/collections") return route.fulfill({ json: [COLLECTION, DIARIES] });
    if (path === "/api/page-types") return route.fulfill({ json: TYPES });
    if (path === "/api/export/bundles") return route.fulfill({ json: [{ id: "b1", name: "216412" }] });
    if (path === "/api/collections/1/checks") return route.fulfill({ json: [] });
    if (path === "/api/instructions") return route.fulfill({ json: {} });
    if (path === "/api/collections/1/page-sorting") return route.fulfill({ json: { sorter: null } });
    return route.fulfill({ status: 404, json: { detail: `Unexpected test request: ${path}` } });
  });
}

const sideMenu = (page: Page) => page.getByRole("navigation", { name: "Setup" }).getByRole("link");
const tabs = (page: Page) => page.getByRole("navigation", { name: "Series" }).getByRole("link");
const switcher = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^Series: / });
const SECTIONS = [["Overview", "overview", "Check how Item 216412 was read"], ["Structure", "levels", "Structure"],
  ["Kinds of page", "page-types", "Kinds of page"], ["Checks", "checks", "Checks"], ["Sorting", "sorting", "Sorting"]] as const;

test("a series' Setup button, on its page and on its row at home, opens its Setup", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Setup of Wilfred Prest Survey" })).toHaveAttribute("href", "/?series=1&view=setup");
  await page.getByRole("link", { name: "Setup of Strathfieldsaye Estate Diaries" }).click();
  await expect(page).toHaveURL("/?series=2&view=setup");
  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();

  await page.goto("/?series=1");
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await expect(page).toHaveURL("/?series=1&view=setup");
  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check how Item 216412 was read" })).toBeVisible();
});

test("a series that isn't set up opens its Setup sections by address, the first named Set up", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/collections/1", (route) =>
    route.fulfill({ json: { ...COLLECTION, levels: [], pageTypes: 0, templates: 0, pages: 0, bundles: 0 } }));
  const heading = (name: string) => page.getByRole("heading", { name, level: 2 });
  for (const [url, shown] of [["section=page-types", "Kinds of page"], ["section=levels", "Structure"], ["view=page-types", "Kinds of page"]]) {
    await page.goto(`/?series=1&${url.startsWith("view") ? url : `view=setup&${url}`}`);
    await expect(heading(shown)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set up this series" })).toHaveCount(0);
  }
  await expect(sideMenu(page).first()).toHaveText("Set up");
});

test("the side menu lists each section, which opens with its name in the address", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?series=1&view=setup");
  await expect(sideMenu(page)).toHaveText(SECTIONS.map(([label]) => label));
  for (const [label, key, heading] of SECTIONS) {
    await sideMenu(page).filter({ hasText: new RegExp(`^${label}$`) }).click();
    await expect(page).toHaveURL(`/?series=1&view=setup&section=${key}`);
    await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
    await expect(page.locator('nav[aria-label="Setup"] [aria-current="page"]')).toHaveText(label);
  }
});

test("a section that is missing or unknown opens the overview", async ({ page }) => {
  await mockApi(page);
  for (const url of ["/?series=1&view=setup", "/?series=1&view=setup&section=nonsense"]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Check how Item 216412 was read" })).toBeVisible();
    await expect(page.locator('nav[aria-label="Setup"] [aria-current="page"]')).toHaveText("Overview");
  }
});

test("a set-up series' overview shows a read item's pages, one box per record, with its kinds of page", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?series=1&view=setup");
  await expect(page.getByText("Does each page have the right kind, and each survey the right pages? Pages are in scan order.")).toBeVisible();
  const boxes = page.getByRole("list", { name: "Surveys of Item 216412" }).getByRole("listitem");
  await expect(boxes).toHaveCount(3);
  const expected = [["Not in a survey", ["Notes page"]], ["Survey 3", ["Main page", "Notes page"]], ["Survey 7", ["Main page", "Notes page"]]] as const;
  for (const [i, [heading, kinds]] of expected.entries()) {
    await expect(boxes.nth(i).locator("p")).toHaveText(heading);
    await expect(boxes.nth(i).getByRole("link")).toHaveText([...kinds]);
  }
  await expect(page.getByText("Main page · 2")).toBeVisible();
  await expect(page.getByText("Notes page · 3")).toBeVisible();
  await expect(page.getByText("Unknown · 0")).toBeVisible();
  await expect(page.getByText("One survey")).toBeVisible();
  await expect(page.getByText("Starts at each Main page")).toBeVisible();
});

test("the overview says when it can't load, instead of spinning, and clears that once another item is chosen", async ({ page }) => {
  await mockApi(page);
  const loading = page.getByText("Loading its pages…");
  let listFails = true;
  await page.route((url) => url.pathname === "/api/export/bundles", (route) => {
    if (listFails) return route.fulfill({ status: 500, json: { detail: "The list of items could not be read." } });
    return route.fulfill({ json: [{ id: "b1", name: "216412" }, { id: "b2", name: "216413" }] });
  });
  await page.route((url) => /^\/api\/collections\/1\/items\/\d+$/.test(url.pathname), (route) => {
    if (route.request().url().endsWith("/216412")) return route.fulfill({ status: 500, json: { detail: "That item could not be read." } });
    return route.fulfill({ json: { ...ITEM, bundle: "216413", name: "216413", records: [] } });
  });

  await page.goto("/?series=1&view=setup");
  await expect(page.getByRole("alert")).toHaveText("The list of items could not be read.");
  await expect(loading).toHaveCount(0);

  listFails = false;
  await page.goto("/?series=1&view=setup");
  await expect(page.getByRole("alert")).toHaveText("That item could not be read.");
  await expect(loading).toHaveCount(0);
  await page.getByLabel("Item", { exact: true }).selectOption("216413");
  await expect(page.getByRole("list", { name: /^Surveys of / })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(loading).toHaveCount(0);
});

test("\"Doesn't look right?\" leads to how its surveys are grouped, its kinds of page, or the setup wizard", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?series=1&view=setup");
  await expect(page.getByText("Doesn't look right?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Change how surveys are grouped" })).toHaveAttribute("href", "/?series=1&view=setup&section=levels");
  await expect(page.getByRole("link", { name: "Change the kinds of page" })).toHaveAttribute("href", "/?series=1&view=setup&section=page-types");
  await expect(page.getByRole("link", { name: "Open the setup wizard" })).toHaveAttribute("href", "/?series=1&view=setup&section=wizard");

  await page.getByRole("link", { name: "Open the setup wizard" }).click();
  await expect(page).toHaveURL("/?series=1&view=setup&section=wizard");
  await expect(page.getByRole("heading", { name: "Set up this series" })).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Change how surveys are grouped" }).click();
  await expect(page).toHaveURL("/?series=1&view=setup&section=levels");
  await expect(page.getByRole("heading", { name: "Structure", level: 2 })).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Change the kinds of page" }).click();
  await expect(page).toHaveURL("/?series=1&view=setup&section=page-types");
  await expect(page.getByRole("heading", { name: "Kinds of page", level: 2 })).toBeVisible();
});

test("Items, Accuracy and Setup switch without loading the page again, and Back returns to the screen before", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?series=1");
  await page.evaluate(() => { (window as unknown as { kept: boolean }).kept = true; });
  await expect(tabs(page).first()).toHaveAttribute("aria-current", "page");

  await tabs(page).nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/?series=1&view=accuracy");
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused(); // the link pressed is gone

  const history = await page.evaluate(() => window.history.length);
  await tabs(page).nth(1).click(); // the tab already shown
  await expect(page).toHaveURL("/?series=1&view=accuracy");
  expect(await page.evaluate(() => window.history.length)).toBe(history);

  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await expect(page).toHaveURL("/?series=1&view=setup");
  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL("/?series=1&view=accuracy");
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL("/?series=1");
  await expect(page.getByRole("heading", { name: "All items" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
});

test("the series menu keeps the Setup section for another series, but not the setup wizard", async ({ page }) => {
  await mockApi(page);
  const other = () => page.getByRole("menuitem", { name: DIARIES.name });
  await page.goto("/?series=1&view=setup&section=wizard");
  await switcher(page).click();
  await expect(other()).toHaveAttribute("href", "/?series=2&view=setup");

  await page.goto("/?series=1&view=setup&section=checks");
  await switcher(page).click();
  await expect(other()).toHaveAttribute("href", "/?series=2&view=setup&section=checks");

  await page.goto("/?series=1&view=page-types");
  await switcher(page).click();
  await expect(other()).toHaveAttribute("href", "/?series=2&view=setup&section=page-types");
});

test("the series' name shows in its header and in the series menu, which leads to its Items, Accuracy and Setup", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?series=1");
  await expect(page.getByRole("heading", { name: "Wilfred Prest Survey", level: 1 })).toBeVisible();
  await expect(tabs(page)).toHaveText(["Items", "Accuracy"]);

  await page.goto("/?series=1&view=setup");
  await expect(switcher(page)).toHaveAccessibleName("Series: Wilfred Prest Survey");
  await switcher(page).click();
  await expect(page.getByRole("menuitem", { name: "Items" })).toHaveAttribute("href", "/?series=1");
  await expect(page.getByRole("menuitem", { name: "Accuracy" })).toHaveAttribute("href", "/?series=1&view=accuracy");
  await expect(page.getByRole("menuitem", { name: "Setup" })).toHaveAttribute("href", "/?series=1&view=setup");
});
