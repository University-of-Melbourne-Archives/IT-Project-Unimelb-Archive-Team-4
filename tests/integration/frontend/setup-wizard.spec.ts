import { test, expect, type Page } from "@playwright/test";
import { serveItems, type MockItem } from "./items-mock";

// Setting a series up by the wizard in its Setup screen (/?series=2&view=setup), on an intercepted API: nothing reaches the real
// backend, the archive or a model.
const SERIES = {
  id: 2, name: "Letters", recordName: "record", grouped: false, archiveSeries: 7, archiveIdentifier: null, unknownPages: 0, bundles: 0,
};
const ITEMS: MockItem[] = [
  { bundle: "101", name: "101", loaded: false, archive: { identifier: "UMA-IT-1", title: "Letters 1901" } },
  { bundle: "102", name: "102", loaded: false, archive: { identifier: "UMA-IT-2", title: "Letters 1902" } },
];
// a 1-pixel PNG, for every page's scan
const SCAN = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const MODEL = { provider: "claude", model: "opus", effort: "high" };
const OPTIONS = { claude: { available: true, error: null, efforts: ["low", "medium", "high"],
  models: [{ value: "opus", label: "Opus", group: "latest", efforts: ["low", "medium", "high"], defaultEffort: "medium" }] } };

type Type = { name: string; label: string; builtIn: boolean; unknown: boolean; templateVersion: number | null };
type Level = { name: string; key: string | null; parts: object[] };
const UNKNOWN: Type = { name: "unknown_2", label: "Unknown", builtIn: true, unknown: true, templateVersion: null };
const kind = (name: string, label: string, templateVersion: number | null = null): Type =>
  ({ name, label, builtIn: false, unknown: false, templateVersion });
// What the model said it saw in a sample: groups of pages that look alike
const SEEN = [
  { label: "Printed card", description: "A printed card with a photo.", pages: [1, 2] },
  { label: "Letter", description: "Handwritten and signed.", pages: [3] },
  { label: "Cover", description: "", pages: [4] },
  { label: "Order form", description: "Ruled columns.", pages: [5, 6] },
];

// The series (its counts following its page types), its items, the model that would look, and what the series is told, as the
// test changes them: page types, what its sample's pages were said to be, its levels, how many pages were read, whether a
// reading is running, and why looking fails (empty: it works).
async function mock(page: Page, over: { items?: MockItem[]; types?: Type[]; read?: number; levels?: Level[]; running?: number } = {}) {
  const state = {
    types: [UNKNOWN, ...(over.types ?? [])], labels: {} as Record<string, string>, levels: over.levels ?? [], read: over.read ?? 0,
    running: over.running ?? 0, failure: "", sent: [] as unknown[],
  };
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const body = method === "GET" ? undefined : route.request().postDataJSON();
    if (body) state.sent.push({ [`${method} ${path}`]: body });
    const label = path.match(/^\/api\/collections\/2\/items\/\d+\/labels(?:\/(\d+))?$/);
    if (label && label[1]) {
      if (body.pageType) state.labels[label[1]] = body.pageType;
      else delete state.labels[label[1]];
    }
    if (label) return route.fulfill({ json: state.labels });
    if (path === "/api/collections/2/page-types/suggest") {
      return state.failure ? route.fulfill({ status: 502, json: { detail: state.failure } }) : route.fulfill({ json: { types: SEEN } });
    }
    if (path === "/api/page-types" && method === "POST") {
      const created = kind(body.label.toLowerCase().replaceAll(" ", "_"), body.label);
      state.types.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    const template = path.match(/^\/api\/instructions\/(\w+)$/);
    if (template && method === "POST") {
      state.types.find((t) => t.name === template[1])!.templateVersion = 50 + state.sent.length;
      return route.fulfill({ status: 201, json: { id: 50 + state.sent.length, body: body.body, rules: body.rules } });
    }
    const served = serveItems(over.items ?? ITEMS, route.request());
    if (served) return route.fulfill(served);
    if (path.match(/^\/api\/collections\/2\/items\/\d+\/scans\/\d+$/)) return route.fulfill({ body: SCAN, contentType: "image/png" });
    const own = state.types.filter((t) => !t.unknown);
    if (path === "/api/collections/2/levels" && method === "PUT") {
      state.levels = body.levels;
      return route.fulfill({ json: { ...SERIES } });
    }
    if (path === "/api/collections/2") {
      return route.fulfill({ json: { ...SERIES, levels: state.levels, pageTypes: own.length, templates: own.filter((t) => t.templateVersion).length,
        pages: state.read, running: state.running } });
    }
    if (path === "/api/page-types") return route.fulfill({ json: state.types });
    if (path === "/api/collections/2/page-sorting") return route.fulfill({ json: { sorter: null } });
    if (path === "/api/transcription-models") return route.fulfill({ json: { configured: MODEL, models: [] } });
    if (path === "/api/transcription-options") return route.fulfill({ json: OPTIONS });
    if (path === "/api/reviewers") return route.fulfill({ json: [{ id: 1, name: "Ben" }] });
    if (path === "/api/export/bundles") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: `Unexpected test request: ${path}` } });
  });
  return state;
}

const wizard = (page: Page) => page.getByRole("heading", { name: "Set up this series" });
const questions = (page: Page) => page.getByRole("list", { name: "Questions to answer" });
const question = (page: Page, name: string) => questions(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
const group = (page: Page, label: string) =>
  questions(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: /look alike/ }) }).filter({ hasText: new RegExp(`${label} · `) });
const suggests = (sent: unknown[]) => sent.filter((s) => "POST /api/collections/2/page-types/suggest" in (s as object));

// Looks at a sample item's pages, as a user confirms it.
async function look(page: Page) {
  await page.getByRole("button", { name: /^Look at (some|more) pages$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Look at them" }).click();
}

test("a series that isn't set up opens Setup on the wizard, asking to look at some pages first", async ({ page }) => {
  await mock(page);
  await page.goto("/?series=2&view=setup");
  await expect(wizard(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Setup" }).getByRole("link", { name: "Set up" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Item to look at").locator("option")).toHaveText(["Letters 1901", "Letters 1902"]);
  await expect(page.getByRole("button", { name: "Look at some pages" })).toBeEnabled();
  await expect(page.getByText("Look at some pages to start.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the overview" })).toHaveCount(0);
});

test("an item chosen to look at is only shown to the model once it's confirmed, saying which model is asked", async ({ page }) => {
  const { sent } = await mock(page);
  await page.goto("/?series=2&view=setup");
  await page.getByLabel("Item to look at").selectOption({ label: "Letters 1902" });
  await page.getByRole("button", { name: "Look at some pages" }).click();
  const dialog = page.getByRole("dialog", { name: "Look at 30 pages of Letters 1902" });
  await expect(dialog).toContainText("Opus · Claude Code");
  await expect(dialog).toContainText("low (reading uses high: telling pages apart needs less)");
  await expect(dialog).toContainText("Your Claude Pro or Max plan: one request");
  await expect(dialog).toContainText("Nothing is saved until you answer.");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(suggests(sent)).toEqual([]);

  await page.getByRole("button", { name: "Look at some pages" }).click();
  await dialog.getByRole("button", { name: "Look at them" }).click();
  await expect(group(page, "Printed card")).toBeVisible();
  expect(suggests(sent)).toEqual([{ "POST /api/collections/2/page-types/suggest": { item: "102", count: 30, pick: "spread", ...MODEL, effort: "low" } }]);
});

test("a group of pages that look alike is made a new kind of page, said to be a kind so far, or skipped", async ({ page }) => {
  const { sent } = await mock(page, { types: [kind("letter", "Letter", 3), kind("form", "Form", 4)] });
  await page.goto("/?series=2&view=setup");
  await look(page);
  await expect(question(page, "These 2 pages look alike. What are they?")).toHaveCount(2);
  const card = group(page, "Printed card");
  await expect(card).toContainText("A printed card with a photo.");
  await expect(card.getByRole("img", { name: "Page 2" })).toBeVisible();
  await expect(card.getByRole("link").first()).toHaveAttribute("href", "/api/collections/2/items/101/scans/1?width=1200");
  sent.length = 0;

  // new, under a name of its own
  await card.getByRole("button", { name: "New kind: Printed card" }).click();
  await card.getByLabel("Name of the new kind").fill("Casualty card");
  await card.getByRole("button", { name: "Add kind" }).click();
  await expect(card).toHaveCount(0);

  // the groups not answered yet are replaced by looking again, which asks first
  await page.getByRole("button", { name: "Look at more pages" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("The 3 groups not answered yet will be replaced.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(suggests(sent)).toEqual([]);

  // one of the kinds so far: by the button when it has the same name, else by the list, which answers once Save is pressed
  await group(page, "Letter").getByRole("button", { name: "They're Letters" }).click();
  await expect(page.getByRole("region", { name: "Answered" })).toContainText("1 page that looked alike:Letters");
  const sentSoFar = sent.length;
  const order = group(page, "Order form");
  const save = order.getByRole("button", { name: "Save", exact: true });
  await order.getByLabel("They're one of the kinds so far").selectOption({ label: "Letters" });
  await expect(save).toBeVisible();
  expect(sent).toHaveLength(sentSoFar);
  await order.getByLabel("They're one of the kinds so far").selectOption({ label: "Forms" });
  await expect(save).toBeVisible();
  expect(sent).toHaveLength(sentSoFar);
  await save.click();
  await group(page, "Cover").getByRole("button", { name: "Skip: covers, blanks" }).click();
  const answered = page.getByRole("region", { name: "Answered" });
  await expect(answered.locator("p")).toHaveCount(4);
  await expect(answered).toContainText("2 pages that looked alike:a new kind, Casualty card");
  await expect(answered).toContainText("1 page that looked alike:Letters");
  await expect(answered).toContainText("1 page that looked alike:skipped");
  await expect(answered).toContainText("2 pages that looked alike:Forms");
  expect(sent).toEqual([
    { "POST /api/page-types": { label: "Casualty card", reviewerId: 1, collectionId: 2 } },
    { "PUT /api/collections/2/items/101/labels/1": { pageType: "casualty_card" } },
    { "PUT /api/collections/2/items/101/labels/2": { pageType: "casualty_card" } },
    { "PUT /api/collections/2/items/101/labels/3": { pageType: "letter" } },
    { "PUT /api/collections/2/items/101/labels/5": { pageType: "form" } },
    { "PUT /api/collections/2/items/101/labels/6": { pageType: "form" } },
  ]);
  // the new kind is next asked for its fields
  await expect(question(page, "What should be written down from each Casualty card?")).toBeVisible();
});

test("what should be written down from a kind of page is saved as its template", async ({ page }) => {
  const { sent } = await mock(page, { types: [kind("casualty_card", "Casualty card")] });
  await page.goto("/?series=2&view=setup");
  const ask = question(page, "What should be written down from each Casualty card?");
  const fields = ask.getByRole("group", { name: "Fields to read from each Casualty card" });
  await expect(fields.getByRole("button", { name: "Save template" })).toBeDisabled();
  await fields.getByLabel("Field 1", { exact: true }).fill("Index No.");
  await fields.getByRole("button", { name: "Add field" }).click();
  await fields.getByLabel("Field 2", { exact: true }).fill("index no");
  await expect(fields.getByText("Two fields have the same name.")).toBeVisible();
  await expect(fields.getByRole("button", { name: "Save template" })).toBeDisabled();
  await fields.getByLabel("Field 2", { exact: true }).fill("Surname");
  await expect(fields.getByText("Two fields have the same name.")).toHaveCount(0);
  await fields.getByRole("button", { name: "Save template" }).click();
  await expect(ask).toHaveCount(0);
  expect(sent).toEqual([
    { "POST /api/instructions/casualty_card": { body: '{\n  "index_no": null,\n  "surname": null\n}', rules: {}, basedOn: null, reviewerId: 1 } },
  ]);
  await expect(question(page, "Where does one record start?")).toBeVisible(); // asked once its kinds have a template
});

test("where one record starts is saved as the series' level", async ({ page }) => {
  const { sent } = await mock(page, { types: [kind("letter", "Letter", 3), kind("form", "Form", 4)] });
  await page.goto("/?series=2&view=setup");
  const ask = question(page, "Where does one record start?");
  await expect(ask.getByRole("button", { name: "Save" })).toBeDisabled(); // no name for one yet
  await ask.getByLabel("What it calls one").fill("survey");
  await ask.getByLabel("Kind of page it starts at").selectOption({ label: "Form" });
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Answered" })).toContainText("Where one record starts:at each Form, with the pages after it");
  expect(sent).toEqual([{ "PUT /api/collections/2/levels": { levels: [{ name: "survey", key: null, parts: [
    { type: "form", count: "one_or_more", how: "starts" }, { type: "letter", count: "any", how: "follows" }] }] } }]);
  await expect(question(page, "Read one item to check it works")).toBeVisible();
});

test("the whole item can be one record, which is saved as no level", async ({ page }) => {
  const { sent } = await mock(page, { types: [kind("letter", "Letter", 3)] });
  await page.goto("/?series=2&view=setup");
  const ask = question(page, "Where does one record start?");
  await ask.getByLabel("What it calls one").fill("survey");
  await ask.getByLabel("The whole item is one survey").check();
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Answered" })).toContainText("Where one record starts:the whole item is one survey");
  expect(sent).toEqual([{ "PUT /api/collections/2/levels": { levels: [] } }]);
});

test("once its kinds and its record are set, the last step points to reading one item", async ({ page }) => {
  const level = { name: "survey", key: null, parts: [{ type: "letter", count: "one_or_more", how: "starts" }] };
  const state = await mock(page, { types: [kind("letter", "Letter", 3)], levels: [level] });
  await page.goto("/?series=2&view=setup");
  await expect(questions(page).getByRole("listitem")).toHaveCount(1);
  const ask = question(page, "Read one item to check it works");
  await expect(ask.getByRole("link", { name: "Open Letters 1901" })).toHaveAttribute("href", "/?series=2&item=101");
  await expect(ask).toContainText("Press Transcribe there, then look at how it came out.");

  state.running = 1;
  await page.reload();
  await expect(ask.getByText("Reading it…")).toBeVisible();
  await expect(ask.getByRole("link")).toHaveCount(0);
});

test("a set-up series' wizard, asked for again, offers to go back to the overview", async ({ page }) => {
  const level = { name: "survey", key: null, parts: [{ type: "letter", count: "one_or_more", how: "starts" }] };
  await mock(page, { types: [kind("letter", "Letter", 3)], levels: [level], read: 5 });
  await page.goto("/?series=2&view=setup&section=wizard");
  await expect(wizard(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Setup" }).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Nothing to ask right now. Look at more pages to check nothing's missing.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Look at more pages" })).toBeEnabled();
  await page.getByRole("link", { name: "Back to the overview" }).click();
  await expect(page).toHaveURL("/?series=2&view=setup");
  await expect(wizard(page)).toHaveCount(0);
});

test("a series with no items yet says to add some first", async ({ page }) => {
  await mock(page, { items: [] });
  await page.goto("/?series=2&view=setup");
  await expect(page.getByText("Add items to the series on its Items page first.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Items", exact: true }).last()).toHaveAttribute("href", "/?series=2");
  await expect(page.getByLabel("Item to look at")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Look at some pages" })).toHaveCount(0);
});

test("pages that can't be looked at say why, and can be looked at again", async ({ page }) => {
  const state = await mock(page);
  state.failure = "Couldn't get its scans from the archive (timed out).";
  await page.goto("/?series=2&view=setup");
  await look(page);
  await expect(page.getByRole("alert")).toContainText("Couldn't get its scans from the archive (timed out).");
  await expect(questions(page)).toHaveCount(0);
  state.failure = "";
  await look(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(group(page, "Printed card")).toBeVisible();
});
