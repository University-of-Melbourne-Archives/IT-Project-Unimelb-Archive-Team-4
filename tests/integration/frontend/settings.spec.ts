import { test, expect, type Page } from "@playwright/test";

// The API is intercepted: no requests reach the real backend, and the real claude and codex programs are never run.
const conn = (over: object = {}) => ({
  installed: true, signedIn: false, method: null, plan: null, version: null, warnings: [], error: null,
  login: { running: false, exitCode: null }, ...over,
});
const ready = (over: object = {}) => conn({ signedIn: true, method: "claude.ai", plan: "max", version: "2.1.288", ...over });

type State = { claude: ReturnType<typeof conn>; codex: ReturnType<typeof conn> };
type Defaults = { provider: string; model: string; effort: string };
const SAVED: Defaults = { provider: "claude", model: "claude-saved-model", effort: "high" };
const APP: Defaults = { provider: "codex", model: "gpt-app-model", effort: "medium" };
const OPENAI: Defaults = { provider: "openai", model: "gpt-x", effort: "default" };
const FOLDERS = { data: "C:\\projects\\survey\\data", output: "C:\\projects\\survey\\output" };
const RELEASES = "https://github.com/bennos280/IT-Project-Unimelb-Archive-Team-4/releases";
const REPO = "https://github.com/bennos280/IT-Project-Unimelb-Archive-Team-4";
const SYSTEM = { os: "Windows 11", python: "3.12.4", pytorch: true };
const CHECKED_AT = "2026-10-20T04:05:00Z";
const UP_TO_DATE = { current: "v0.2.0", latest: "v0.2.0", releases: RELEASES, error: null, updatable: false, checkedAt: CHECKED_AT, system: SYSTEM };
const ABOUT = "/?view=settings&tab=about"; // the About tab is hidden until opened
const KEYS = [["gemini", "Gemini API"], ["anthropic", "Claude API"], ["openai", "OpenAI API"], ["openrouter", "OpenRouter"]];

type Options = {
  defaults?: Defaults | null; // the saved choice; null: nothing saved yet; left out: SAVED
  saveError?: string; // a 400 for PUT /transcription-defaults
  testReply?: object; // the body of a test request's reply
  testStatus?: number;
  gateTests?: boolean; // hold test replies until calls.release()
  // The body of GET /transcription-options, or a function of the providers that have a key; without it the request fails.
  transcriptionOptions?: object | ((withKey: string[]) => object);
  keys?: string[]; // the API providers with a key saved
  envKeys?: string[]; // the API providers whose key comes from the computer's settings
  keyError?: string; // a 400 for PUT /api-keys/<provider>
  keysFail?: boolean; // GET /api-keys answers 500
  connectionsFail?: string; // GET /api/connections answers 500 with this detail (calls.connectionsFail changes it later)
  sorting?: { method: string; sorter: object | null }; // page sorting as saved (left out: the reading model, no sorter)
  version?: object; // the body of GET /api/version; left out: UP_TO_DATE
  versionFails?: boolean; // GET /api/version answers 500 (calls.versionFails changes it later)
  foldersFail?: boolean; // GET /api/folders answers 500
  openError?: string; // POST /api/folders/<which>/open answers 500 with this detail (calls.openError changes it later)
  updateStatus?: number; // the status of POST /api/update; left out: 202
};

async function mockApi(page: Page, state: State, options: Options = {}) {
  let defaults = options.defaults === undefined ? SAVED : options.defaults;
  let release = () => {};
  const gate = options.gateTests ? new Promise<void>((resolve) => { release = resolve; }) : null;
  const keys = new Map(KEYS.map(([provider]) => [provider, { saved: options.keys?.includes(provider) ?? false, fromEnvironment: options.envKeys?.includes(provider) ?? false }]));
  const keyList = () => KEYS.map(([provider, label]) => ({ provider, label, keysUrl: `https://example.com/${provider}/keys`, needsKey: true, ...keys.get(provider)! }));
  const withKey = () => [...keys].filter(([, k]) => k.saved || k.fromEnvironment).map(([provider]) => provider);
  const sorting = { method: options.sorting?.method ?? "model", sorter: options.sorting?.sorter ?? null };
  const calls = {
    get: 0, updates: 0, post: [] as string[], delete: [] as string[], loginBody: [] as unknown[],
    put: [] as unknown[], logout: [] as string[], logoutBody: [] as unknown[], tests: [] as string[], testBody: [] as unknown[],
    keyPuts: [] as { provider: string; body: unknown }[], options: 0, sortingGets: 0, sortingPuts: [] as unknown[],
    release: () => release(), connectionsFail: options.connectionsFail ?? "",
    versions: 0, versionBody: options.version ?? UP_TO_DATE, versionFails: options.versionFails ?? false, opened: [] as string[],
    openError: options.openError ?? "",
    // Holds the replies to GET /api/version until the returned function is called.
    holdVersion: () => { let open = () => {}; versionGate = new Promise<void>((resolve) => { open = resolve; }); return open; },
  };
  let versionGate: Promise<void> | null = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const login = path.match(/^\/api\/connections\/(claude|codex)\/login$/);
    const logout = path.match(/^\/api\/connections\/(claude|codex)\/logout$/);
    const tested = path.match(/^\/api\/connections\/(claude|codex)\/test$/);
    const keyed = path.match(/^\/api\/api-keys\/(\w+)$/);
    if (path === "/api/transcription-defaults" && request.method() === "PUT") {
      calls.put.push(request.postDataJSON());
      if (options.saveError) return route.fulfill({ status: 400, json: { detail: options.saveError } });
      defaults = request.postDataJSON();
      return route.fulfill({ json: defaults });
    }
    const opened = path.match(/^\/api\/folders\/(data|output)\/open$/);
    if (opened && request.method() === "POST") {
      calls.opened.push(opened[1]);
      return calls.openError ? route.fulfill({ status: 500, json: { detail: calls.openError } }) : route.fulfill({ status: 204 });
    }
    if (path === "/api/folders")
      return options.foldersFail ? route.fulfill({ status: 500, json: { detail: "No folders." } }) : route.fulfill({ json: FOLDERS });
    if (logout && request.method() === "POST") {
      calls.logout.push(logout[1]);
      calls.logoutBody.push(request.postDataJSON());
      state[logout[1] as keyof State] = conn({ version: state[logout[1] as keyof State].version });
      return route.fulfill({ json: state[logout[1] as keyof State] });
    }
    if (tested && request.method() === "POST") {
      calls.tests.push(tested[1]);
      calls.testBody.push(request.postDataJSON());
      await gate;
      return route.fulfill({ status: options.testStatus ?? 200, json: options.testReply ?? { ok: true, seconds: 3.2, model: "haiku", message: "Replied in 3.2 s" } });
    }
    if (path === "/api/connections") {
      calls.get++;
      return calls.connectionsFail ? route.fulfill({ status: 500, json: { detail: calls.connectionsFail } }) : route.fulfill({ json: state });
    }
    if (login && request.method() === "POST") {
      calls.post.push(login[1]);
      calls.loginBody.push(request.postDataJSON());
      state[login[1] as keyof State].login = { running: true, exitCode: null };
      return route.fulfill({ status: 202, json: state[login[1] as keyof State].login });
    }
    if (login && request.method() === "DELETE") {
      calls.delete.push(login[1]);
      state[login[1] as keyof State].login = { running: false, exitCode: null };
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/transcription-options") {
      calls.options++;
      const body = options.transcriptionOptions;
      if (!body) return route.fulfill({ status: 500, json: { detail: "No models." } });
      return route.fulfill({ json: typeof body === "function" ? body(withKey()) : body });
    }
    if (path === "/api/transcription-models")
      return route.fulfill({ json: { configured: defaults, models: [] } });
    if (path === "/api/page-sorting") {
      if (request.method() === "PUT") {
        calls.sortingPuts.push(request.postDataJSON());
        Object.assign(sorting, { method: "model", sorter: null });
      } else {
        calls.sortingGets++;
      }
      return route.fulfill({ json: { ...sorting, unsure: "review", localAvailable: true, checked: null } });
    }
    if (keyed && request.method() === "PUT") {
      const body = request.postDataJSON();
      calls.keyPuts.push({ provider: keyed[1], body });
      if (options.keyError) return route.fulfill({ status: 400, json: { detail: options.keyError } });
      keys.get(keyed[1])!.saved = Boolean(body.key);
      return route.fulfill({ json: keyList() });
    }
    if (path === "/api/api-keys")
      return options.keysFail ? route.fulfill({ status: 500, json: { detail: "No keys." } }) : route.fulfill({ json: keyList() });
    if (path === "/api/version") {
      calls.versions++;
      await versionGate;
      return calls.versionFails ? route.fulfill({ status: 500, json: { detail: "No version." } }) : route.fulfill({ json: calls.versionBody });
    }
    if (path === "/api/update" && request.method() === "POST") {
      calls.updates++;
      return route.fulfill({ status: options.updateStatus ?? 202, json: options.updateStatus ? { detail: "This copy wasn't installed from a release: update it with git pull." } : { updating: true } });
    }
    if (path === "/api/collections/1/items")
      return route.fulfill({ json: { items: [], page: 0, total: 0, all: 0, transcribed: 0, totals: { total: 0, reviewable: 0, unassigned: 0, reviewed: 0, ready: 0 } } });
    if (path === "/api/collections")
      return route.fulfill({ json: [{ id: 1, name: "Test Survey", archiveSeries: 499420, bundles: 0, pages: 0 }] });
    return route.fulfill({ status: 404, json: { detail: `Unexpected test request: ${path}` } });
  });
  return calls;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const claudeModel = (value: string, label = value) => ({ value, label, group: "used", efforts: EFFORTS, defaultEffort: null });
// An API or local provider's models: they have no efforts of their own.
const apiModels = (...values: string[]) => ({ available: true, error: null, efforts: [], models: values.map((value) => ({ value, label: value, group: "listed", efforts: null, defaultEffort: null })) });
const NO_MODELS = { available: false, error: null, efforts: [], models: [] };
const OPTIONS = {
  claude: { available: true, error: null, efforts: EFFORTS, models: [claudeModel("claude-used-1"), claudeModel("opus", "opus (latest)"), claudeModel("sonnet", "sonnet (latest)")] },
  codex: { available: true, error: null, efforts: ["low", "medium", "high"], models: [
    { value: "gpt-a", label: "GPT A", group: "listed", efforts: ["low", "medium"], defaultEffort: "medium" },
    { value: "gpt-b", label: "GPT B", group: "listed", efforts: ["high"], defaultEffort: "high" }] },
  openai: apiModels("gpt-x", "gpt-y"),
};
// The models of an API provider are listed only once it has a key.
const keyed = (withKey: string[]) => ({ ...OPTIONS, openai: withKey.includes("openai") ? OPTIONS.openai : NO_MODELS });

const model = (page: Page) => page.locator("section#transcription-defaults");
const field = (page: Page, name: string) => model(page).getByLabel(name, { exact: true }); // not the tab panel, which the Model tab labels
const way = (page: Page, name: string) => page.getByRole("radiogroup", { name: "How you pay for the AI" }).getByRole("radio", { name, exact: true });
const change = (page: Page) => model(page).getByRole("button", { name: "Change", exact: true });
const done = (page: Page) => model(page).getByRole("button", { name: "Done", exact: true });
const options = (page: Page, label: string) => field(page, label).locator("option");
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const panel = (page: Page, name: string) => page.getByRole("tabpanel", { name, exact: true });

// Opens Settings with the saved choice, and the form with Change.
async function openForm(page: Page) {
  await page.goto("/?view=settings");
  await change(page).click();
}

test("Settings has a heading, a subtitle and two tabs, Model first", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto("/?view=settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByText("How pages are read, and the accounts that read them", { exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Settings" }).getByRole("tab")).toHaveText(["Model", "About"]);
  await expect(tab(page, "Model")).toHaveAttribute("aria-selected", "true");
  await expect(panel(page, "Model").getByRole("heading", { name: "Transcription model", level: 2 })).toBeVisible();
  await tab(page, "About").click();
  for (const title of ["PrestCribe v0.2.0", "Where your files are", "Help"]) await expect(panel(page, "About").getByRole("heading", { name: title, level: 2 })).toBeVisible();
});

test("a tab opens from ?tab=, clicking one shows it and puts it in the URL, and any other tab is Model", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto(ABOUT);
  await expect(tab(page, "About")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("section#updates")).toBeVisible();
  await expect(model(page)).toBeHidden();

  await tab(page, "Model").click();
  await expect(page).toHaveURL(/\/\?view=settings&tab=transcription$/);
  await expect(model(page)).toBeVisible();
  await expect(page.locator("section#updates")).toBeHidden();
  await tab(page, "About").click();
  await expect(page).toHaveURL(/\/\?view=settings&tab=about$/);

  for (const gone of ["nonsense", "accounts", "sorting"]) {
    await page.goto(`/?view=settings&tab=${gone}`);
    await expect(tab(page, "Model")).toHaveAttribute("aria-selected", "true");
    await expect(model(page)).toBeVisible();
  }
});

test("switching tabs loads nothing again and keeps what was chosen", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null });
  await page.goto("/?view=settings");
  await way(page, "API key").click();
  await expect(field(page, "Provider")).toHaveValue("gemini");
  await expect(page.locator("section#updates")).toContainText("Up to date"); // About is loaded while it is hidden
  const loaded = calls.get;
  await tab(page, "About").click();
  await tab(page, "Model").click();
  await expect(way(page, "API key")).toBeChecked();
  await expect(field(page, "Provider")).toHaveValue("gemini");
  expect(calls.get).toBe(loaded);
});

test("the app's name returns to the series list", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto("/?view=settings");
  await page.getByRole("link", { name: "PrestCribe" }).click();
  await expect(page.getByRole("heading", { name: "Series", level: 1 })).toBeVisible();
});

test("the top bar's Settings opens the settings page on the Model tab", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto("/?series=1");
  await page.getByRole("banner").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/\?view=settings$/);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(tab(page, "Model")).toHaveAttribute("aria-selected", "true");
});

test("on a phone the summary, the form and the About tab don't scroll sideways", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: ready({ method: "chatgpt" }) });
  await page.setViewportSize({ width: 375, height: 800 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.goto("/?view=settings");
  await expect(change(page)).toBeVisible();
  expect(await fits()).toBe(true);
  await change(page).click();
  await expect(done(page)).toBeVisible();
  expect(await fits()).toBe(true);
  await tab(page, "About").click();
  await expect(page.locator("section#folders code")).toHaveCount(2);
  expect(await fits()).toBe(true);
});

test("sign-in status that can't be loaded says why and Try again loads it", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { connectionsFail: "No sign-in status." });
  await page.goto("/?view=settings");
  await expect(page.getByRole("alert").filter({ hasText: "No sign-in status." })).toBeVisible();
  calls.connectionsFail = "";
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(model(page).getByRole("button", { name: "Test connection" })).toBeVisible();
});

test("API keys that can't be loaded say so", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { keysFail: true });
  await page.goto("/?view=settings");
  await expect(page.getByRole("alert").filter({ hasText: "No keys." })).toBeVisible();
});

// The first run: nothing saved, so the form is all there is.

test("with nothing saved the form shows straight away, subscription first, with no summary and nothing sent", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null });
  await page.goto("/?view=settings");
  await expect(page.getByRole("radiogroup", { name: "How you pay for the AI" }).getByRole("radio")).toHaveText(["Subscription", "API key", "Local"]);
  await expect(way(page, "Subscription")).toBeChecked();
  await expect(way(page, "API key")).not.toBeChecked();
  await expect(options(page, "Provider")).toHaveText(["Claude Code", "Codex CLI"]);
  await expect(field(page, "Model")).toBeVisible();
  await expect(change(page)).toHaveCount(0);
  await expect(done(page)).toHaveCount(0);
  expect(calls.put).toEqual([]);
});

test("each way of paying lists its providers, and Local has only Ollama", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null });
  await page.goto("/?view=settings");
  await way(page, "API key").click();
  await expect(way(page, "API key")).toBeChecked();
  await expect(options(page, "Provider")).toHaveText(["Gemini API", "Claude API", "OpenAI API", "OpenRouter"]);
  await expect(field(page, "Provider")).toHaveValue("gemini");
  await way(page, "Local").click();
  await expect(field(page, "Provider")).toHaveCount(0);
  await way(page, "Subscription").click();
  await expect(field(page, "Provider")).toHaveValue("claude");
});

test("first run with an API provider that has a key: its models are listed, and picking one saves it with the effort default", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null, keys: ["openai"], transcriptionOptions: keyed });
  await page.goto("/?view=settings");
  await way(page, "API key").click();
  await field(page, "Provider").selectOption("openai");
  await expect(options(page, "Model")).toHaveText(["Choose a model…", "gpt-x", "gpt-y"]);
  await expect(field(page, "Model")).toHaveValue(""); // nothing is picked for you
  await expect(field(page, "Effort")).toHaveCount(0); // API models have one effort
  expect(calls.put).toEqual([]);

  await field(page, "Model").selectOption("gpt-x");
  await expect.poll(() => calls.put).toEqual([OPENAI]);
  await expect(model(page)).toContainText("gpt-x");
  await expect(model(page)).toContainText("OpenAI API · Your own OpenAI API key");
  await expect(change(page)).toBeVisible();
  await expect(field(page, "Model")).toHaveCount(0);

  await page.reload();
  await expect(model(page)).toContainText("gpt-x");
  await expect(model(page)).toContainText("OpenAI API");
});

test("a subscription's effort is chosen by hand: nothing is saved until the model and the effort are both chosen", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null, transcriptionOptions: OPTIONS });
  await page.goto("/?view=settings");
  await expect(options(page, "Model")).toHaveText(["Choose a model…", "claude-used-1", "opus (latest)", "sonnet (latest)"]);
  await expect(field(page, "Model")).toHaveValue("");
  await expect(field(page, "Effort")).toHaveValue("");
  await expect(field(page, "Effort")).toBeDisabled(); // no model yet

  await field(page, "Model").selectOption("opus");
  await expect(field(page, "Effort")).toBeEnabled();
  await expect(field(page, "Effort")).toHaveValue(""); // not even a default
  await expect(options(page, "Effort")).toHaveText(["Choose…", ...EFFORTS]);
  await page.evaluate(() => 0);
  expect(calls.put).toEqual([]);

  await field(page, "Effort").selectOption("low");
  await expect.poll(() => calls.put).toEqual([{ provider: "claude", model: "opus", effort: "low" }]);
  await expect(model(page)).toContainText("opus · low");
});

test("a save the API refuses shows its message and keeps the choice made", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null, transcriptionOptions: OPTIONS, saveError: "Enter a valid model name." });
  await page.goto("/?view=settings");
  await field(page, "Model").selectOption("opus");
  await field(page, "Effort").selectOption("low");
  await expect(model(page).getByRole("alert")).toHaveText("Enter a valid model name.");
  expect(calls.put).toHaveLength(1);
  await expect(field(page, "Model")).toHaveValue("opus");
  await expect(field(page, "Effort")).toHaveValue("low");
  await expect(change(page)).toHaveCount(0); // still the form: nothing was saved
});

// The summary of what is saved.

test("the summary names the model, effort, provider and who pays, and a subscription can be tested, checked for usage and signed out of", async ({ page }) => {
  const state: State = { claude: ready({ email: "someone@example.com", orgName: "Secret Org" }), codex: conn() };
  await mockApi(page, state);
  await page.goto("/?view=settings");
  await expect(model(page)).toContainText("claude-saved-model · high");
  await expect(model(page)).toContainText("Claude Code · Your Claude Pro or Max plan");
  await expect(model(page).getByRole("button")).toHaveText(["Test connection", "Sign out", "Change"]);
  await expect(model(page).getByRole("link", { name: "Check usage" })).toHaveAttribute("href", "https://claude.ai/settings/usage");
  await expect(model(page).getByRole("link", { name: "Check usage" })).toHaveAttribute("target", "_blank");
  await expect(model(page).getByRole("link", { name: "Check usage" })).toHaveAttribute("rel", /noopener/);
  await expect(page.locator("body")).not.toContainText(/@example\.com|Secret Org/);
  await expect(model(page)).not.toContainText("Not connected");

  state.codex = ready({ method: "chatgpt", plan: null });
  await page.route("**/api/transcription-models", (route) => route.fulfill({ json: { configured: APP, models: [] } }));
  await page.reload();
  await expect(model(page)).toContainText("gpt-app-model · medium");
  await expect(model(page)).toContainText("Codex CLI · Your ChatGPT plan");
  await expect(model(page).getByRole("link", { name: "Check usage" })).toHaveAttribute("href", "https://chatgpt.com/codex/settings/usage");
});

test("a program signed in with an API key has no usage link, and its warnings are shown", async ({ page }) => {
  const warning = "Transcription is billed to this API key, not to your ChatGPT plan.";
  await mockApi(page, { claude: conn(), codex: ready({ method: "api_key", plan: null, warnings: [warning] }) }, { defaults: APP });
  await page.goto("/?view=settings");
  await expect(model(page)).toContainText(warning);
  await expect(model(page).getByRole("button", { name: "Test connection" })).toBeVisible();
  await expect(model(page).getByRole("link", { name: "Check usage" })).toHaveCount(0);
});

test("an old program version's warning is shown with the summary", async ({ page }) => {
  const warning = "Claude Code 2.1.200 is older than 2.1.280, which transcription needs. Update it with: claude update";
  await mockApi(page, { claude: ready({ version: "2.1.200", warnings: [warning] }), codex: conn() });
  await page.goto("/?view=settings");
  await expect(model(page)).toContainText(warning);
});

test("a saved provider that isn't connected says so and offers nothing else until Change", async ({ page }) => {
  await mockApi(page, { claude: conn(), codex: conn() });
  await page.goto("/?view=settings");
  await expect(model(page)).toContainText("Not connected on this computer. Press Change to connect it.");
  await expect(model(page).getByRole("button", { name: /Test connection|Sign out/ })).toHaveCount(0);
  await expect(model(page).getByRole("button", { name: "Open Claude Code sign-in" })).toHaveCount(0);
  await change(page).click();
  await expect(model(page).getByRole("button", { name: "Open Claude Code sign-in" })).toBeVisible();
});

test("an API provider's summary offers Remove key only for a key saved here, and says when there is no key", async ({ page }) => {
  const cases: [string, Options, boolean, boolean][] = [
    ["saved", { keys: ["openai"] }, true, false],
    ["from the computer's settings", { envKeys: ["openai"] }, false, false],
    ["missing", {}, false, true],
  ];
  for (const [, options, remove, missing] of cases) {
    await mockApi(page, { claude: conn(), codex: conn() }, { defaults: OPENAI, ...options });
    await page.goto("/?view=settings");
    await expect(model(page)).toContainText("gpt-x");
    await expect(model(page)).toContainText("OpenAI API · Your own OpenAI API key");
    await expect(model(page).getByRole("button", { name: "Remove key" })).toHaveCount(remove ? 1 : 0);
    if (missing) await expect(model(page)).toContainText("Not connected on this computer. Press Change to connect it.");
    else await expect(model(page)).not.toContainText("Not connected");
    await page.unroute("**/api/**");
  }
});

test("Ollama's summary says it is free and on this computer, and warns when no models are found", async ({ page }) => {
  const saved = { provider: "ollama", model: "llama3.2-vision", effort: "default" };
  await mockApi(page, { claude: conn(), codex: conn() }, { defaults: saved, transcriptionOptions: { ...OPTIONS, ollama: apiModels("llama3.2-vision") } });
  await page.goto("/?view=settings");
  await expect(model(page)).toContainText("llama3.2-vision");
  await expect(model(page)).toContainText("Ollama · Free, on this computer");
  await expect(model(page)).not.toContainText("Not connected");
  await page.unroute("**/api/**");

  await mockApi(page, { claude: conn(), codex: conn() }, { defaults: saved, transcriptionOptions: { ...OPTIONS, ollama: NO_MODELS } });
  await page.goto("/?view=settings");
  await expect(model(page)).toContainText("Not connected on this computer. Press Change to connect it.");
});

test("Change opens the form in place with the saved choice, and Done goes back to the summary", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { transcriptionOptions: OPTIONS });
  await page.goto("/?view=settings");
  await expect(field(page, "Model")).toHaveCount(0);
  await expect(done(page)).toHaveCount(0);

  await change(page).click();
  await expect(way(page, "Subscription")).toBeChecked();
  await expect(field(page, "Provider")).toHaveValue("claude");
  await expect(field(page, "Model")).toHaveValue("claude-saved-model"); // not in the list, but shown rather than replaced
  await expect(field(page, "Effort")).toHaveValue("high");
  await expect(change(page)).toHaveCount(0);
  await expect(way(page, "Subscription")).toBeFocused(); // focus follows the form

  await done(page).click();
  await expect(model(page)).toContainText("claude-saved-model · high");
  await expect(field(page, "Model")).toHaveCount(0);
  await expect(change(page)).toBeFocused();
  expect(calls.put).toEqual([]);
});

test("a saved model that isn't in its list is shown, and so is an effort it doesn't list", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { defaults: { ...SAVED, effort: "weird" }, transcriptionOptions: OPTIONS });
  await openForm(page);
  await expect(options(page, "Model")).toHaveText(["Choose a model…", "claude-saved-model", "claude-used-1", "opus (latest)", "sonnet (latest)"]);
  await expect(field(page, "Model")).toHaveValue("claude-saved-model");
  await expect(options(page, "Effort")).toHaveText(["Choose…", ...EFFORTS, "weird"]);
  await expect(field(page, "Effort")).toHaveValue("weird");
});

test("changing the choice saves it as soon as it is complete, and Done shows it", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: ready({ method: "chatgpt" }) }, { defaults: { ...SAVED, model: "opus", effort: "max" }, transcriptionOptions: OPTIONS });
  await openForm(page);
  await field(page, "Model").selectOption("sonnet");
  await expect(field(page, "Effort")).toHaveValue("max"); // sonnet has it too
  await expect.poll(() => calls.put).toEqual([{ provider: "claude", model: "sonnet", effort: "max" }]);
  await field(page, "Effort").selectOption("low");
  await expect.poll(() => calls.put.at(-1)).toEqual({ provider: "claude", model: "sonnet", effort: "low" });
  await done(page).click();
  await expect(model(page)).toContainText("sonnet · low");
});

test("switching model keeps a supported effort and clears an unsupported one, which must be chosen again", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: ready({ method: "chatgpt" }) }, { transcriptionOptions: OPTIONS });
  await openForm(page);
  await field(page, "Provider").selectOption("codex");
  await expect(field(page, "Model")).toHaveValue(""); // another provider: nothing carried over
  await expect(field(page, "Effort")).toHaveValue("");
  await field(page, "Model").selectOption("gpt-a");
  await expect(options(page, "Effort")).toHaveText(["Choose…", "low", "medium"]);
  await field(page, "Effort").selectOption("low");
  await expect.poll(() => calls.put).toEqual([{ provider: "codex", model: "gpt-a", effort: "low" }]);

  await field(page, "Model").selectOption("gpt-b");
  await expect(options(page, "Effort")).toHaveText(["Choose…", "high"]);
  await expect(field(page, "Effort")).toHaveValue(""); // low isn't supported by gpt-b
  await page.evaluate(() => 0);
  expect(calls.put).toHaveLength(1);
  await field(page, "Effort").selectOption("high");
  await expect.poll(() => calls.put.at(-1)).toEqual({ provider: "codex", model: "gpt-b", effort: "high" });
});

test("a model that lists no efforts uses its provider's", async ({ page }) => {
  const bare = { ...OPTIONS, codex: { ...OPTIONS.codex, models: [{ value: "gpt-c", label: "GPT C", group: "listed", efforts: [], defaultEffort: null }] } };
  await mockApi(page, { claude: ready(), codex: ready({ method: "chatgpt" }) }, { transcriptionOptions: bare });
  await openForm(page);
  await field(page, "Provider").selectOption("codex");
  await field(page, "Model").selectOption("gpt-c");
  await expect(options(page, "Effort")).toHaveText(["Choose…", "low", "medium", "high"]);
  await expect(field(page, "Effort")).toHaveValue("");
});

test("going back to the saved way of paying brings back the saved choice, and leaving without choosing changes nothing", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { transcriptionOptions: OPTIONS });
  await openForm(page);
  await way(page, "API key").click();
  await expect(field(page, "Provider")).toHaveValue("gemini");
  await way(page, "Local").click();
  await expect(field(page, "Provider")).toHaveCount(0);
  await way(page, "Subscription").click();
  await expect(field(page, "Provider")).toHaveValue("claude");
  await expect(field(page, "Model")).toHaveValue("claude-saved-model");
  await expect(field(page, "Effort")).toHaveValue("high");
  await way(page, "API key").click();
  await done(page).click();
  await expect(model(page)).toContainText("claude-saved-model · high");
  expect(calls.put).toEqual([]);
});

test("an API provider without a key shows the key box; saving a key lists its models", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { transcriptionOptions: keyed });
  await openForm(page);
  await way(page, "API key").click();
  await field(page, "Provider").selectOption("openai");
  await expect(model(page)).toContainText("No key");
  await expect(field(page, "Model")).toHaveCount(0);
  const box = page.getByLabel("OpenAI API key");
  await expect(box).toHaveAttribute("type", "password");
  const save = model(page).getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await expect(model(page).getByRole("link", { name: /Get a key/ })).toHaveAttribute("href", "https://example.com/openai/keys");
  const asked = calls.options;

  await box.fill("sk-test-123");
  await save.click();
  await expect.poll(() => calls.keyPuts).toEqual([{ provider: "openai", body: { key: "sk-test-123" } }]);
  await expect.poll(() => calls.options).toBeGreaterThan(asked); // the lists are loaded again with the key
  await expect(options(page, "Model")).toHaveText(["Choose a model…", "gpt-x", "gpt-y"]);
  await expect(box).toHaveCount(0);
  await expect(model(page).getByRole("button", { name: "Remove key" })).toBeVisible();
});

test("a key the API refuses shows the reason and keeps the key box", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { defaults: OPENAI, keyError: "That key was refused." });
  await openForm(page);
  const box = page.getByLabel("OpenAI API key");
  await box.fill("sk-bad");
  await model(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(model(page).getByRole("alert")).toHaveText("That key was refused.");
  await expect(box).toBeVisible();
});

test("Remove key asks first, and removing sends an empty key and leaves the provider not connected", async ({ page }) => {
  const calls = await mockApi(page, { claude: conn(), codex: conn() }, { defaults: OPENAI, keys: ["openai"], transcriptionOptions: keyed });
  const asked: string[] = [];
  let accept = false;
  page.on("dialog", (dialog) => { asked.push(dialog.message()); return accept ? dialog.accept() : dialog.dismiss(); });
  await page.goto("/?view=settings");
  await model(page).getByRole("button", { name: "Remove key" }).click();
  await expect.poll(() => asked).toEqual(["Remove the OpenAI API key saved on this computer?"]);
  expect(calls.keyPuts).toEqual([]);
  await expect(model(page).getByRole("button", { name: "Remove key" })).toBeVisible();

  accept = true;
  await model(page).getByRole("button", { name: "Remove key" }).click();
  await expect.poll(() => calls.keyPuts).toEqual([{ provider: "openai", body: { key: "" } }]);
  await expect(model(page)).toContainText("Not connected on this computer. Press Change to connect it.");
  await expect(model(page).getByRole("button", { name: "Remove key" })).toHaveCount(0);
});

test("when a connected provider's models can't be listed the model is typed, and saved on Enter", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null });
  await page.goto("/?view=settings");
  await expect(model(page)).toContainText("couldn't be listed");
  await expect(field(page, "Model")).toHaveAttribute("placeholder", "Model name");
  await field(page, "Model").fill("typed-model");
  await field(page, "Effort").fill("medium");
  expect(calls.put).toEqual([]);
  await field(page, "Model").press("Enter");
  await expect.poll(() => calls.put).toEqual([{ provider: "claude", model: "typed-model", effort: "medium" }]);
  await expect(model(page)).toContainText("typed-model · medium");
});

test("an API provider whose models can't be listed shows why, and the typed model is saved when the box is left", async ({ page }) => {
  const broken = { ...OPTIONS, openai: { available: true, models: [], efforts: [], error: "Couldn't read the OpenAI model list." } };
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null, keys: ["openai"], transcriptionOptions: broken });
  await page.goto("/?view=settings");
  await way(page, "API key").click();
  await field(page, "Provider").selectOption("openai");
  await expect(model(page)).toContainText("Couldn't read the OpenAI model list.");
  await expect(field(page, "Effort")).toHaveCount(0);
  await field(page, "Model").fill("gpt-typed");
  expect(calls.put).toEqual([]);
  await field(page, "Model").press("Tab");
  await expect.poll(() => calls.put).toEqual([{ provider: "openai", model: "gpt-typed", effort: "default" }]);
});

test("Ollama is chosen from the models it lists, with the effort default", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null, transcriptionOptions: { ...OPTIONS, ollama: apiModels("llama3.2-vision") } });
  await page.goto("/?view=settings");
  await way(page, "Local").click();
  await expect(field(page, "Provider")).toHaveCount(0);
  await field(page, "Model").selectOption("llama3.2-vision");
  await expect.poll(() => calls.put).toEqual([{ provider: "ollama", model: "llama3.2-vision", effort: "default" }]);
});

test("without Ollama's models it says how to get them, and Check again looks again", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { defaults: null, transcriptionOptions: { ...OPTIONS, ollama: NO_MODELS } });
  await page.goto("/?view=settings");
  await way(page, "Local").click();
  await expect(model(page)).toContainText("Install Ollama, then download a model that reads images");
  await expect(model(page).getByRole("link", { name: "Get Ollama" })).toHaveAttribute("href", "https://ollama.com/download");
  await expect(field(page, "Model")).toHaveCount(0);
  const asked = calls.options;
  await model(page).getByRole("button", { name: "Check again" }).click();
  await expect.poll(() => calls.options).toBeGreaterThan(asked);
});

// Page sorting follows the transcription model: opening Settings puts a saved sorting method or model of its own back.

const RESET = { method: "model", sameAsTranscription: true };
for (const [name, sorting, reset] of [
  ["on this computer", { method: "local", sorter: null }, true],
  ["with a model of its own", { method: "model", sorter: { provider: "claude", model: "sonnet", effort: "low" } }, true],
  ["by the transcription model already", { method: "model", sorter: null }, false],
] as const) {
  test(`page sorting saved ${name}: ${reset ? "put back to the transcription model" : "left alone"}`, async ({ page }) => {
    const calls = await mockApi(page, { claude: ready(), codex: conn() }, { sorting });
    await page.goto("/?view=settings");
    await expect.poll(() => calls.sortingGets).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle");
    expect(calls.sortingPuts.length > 0).toBe(reset);
    for (const put of calls.sortingPuts) expect(put).toEqual(RESET); // twice in development, where effects run twice
  });
}

// Connecting a provider from the form: a program's sign-in, or its install.

test("signing in sends a JSON POST, polls while waiting, and then the model can be chosen", async ({ page }) => {
  await page.clock.install();
  const state: State = { claude: conn(), codex: ready({ method: "chatgpt" }) };
  const calls = await mockApi(page, state, { transcriptionOptions: OPTIONS });
  await openForm(page);
  await expect(model(page)).toContainText("Not signed in");
  await model(page).getByRole("button", { name: "Open Claude Code sign-in" }).click();
  await expect(model(page).getByText("Finish signing in in the browser window that opened.")).toBeVisible();
  await expect(model(page).getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(model(page).locator("code")).toHaveText(["claude auth login"]);
  expect(calls.post).toEqual(["claude"]);
  expect(calls.loginBody).toEqual([{}]);
  await expect.poll(() => calls.get).toBeGreaterThan(1);

  const before = calls.get;
  await page.clock.runFor(2000);
  await expect.poll(() => calls.get).toBeGreaterThan(before);
  state.claude = ready({ login: { running: false, exitCode: 0 } });
  await page.clock.runFor(2000);
  await expect(field(page, "Model")).toBeVisible();
  await expect(model(page).getByText("Finish signing in")).toHaveCount(0);

  const settled = calls.get;
  await page.clock.runFor(10000);
  await page.evaluate(() => 0);
  expect(calls.get).toBe(settled);
});

test("no polling while nothing is signing in, and a window focus reloads", async ({ page }) => {
  await page.clock.install();
  const calls = await mockApi(page, { claude: conn(), codex: conn() });
  await openForm(page);
  await expect(model(page)).toContainText("Not signed in");
  const loaded = calls.get;
  await page.clock.runFor(10000);
  await page.evaluate(() => 0);
  expect(calls.get).toBe(loaded);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => calls.get).toBe(loaded + 1);
});

test("Cancel sends a DELETE and returns to the sign-in button", async ({ page }) => {
  const calls = await mockApi(page, { claude: conn({ login: { running: true, exitCode: null } }), codex: conn() });
  await openForm(page);
  await model(page).getByRole("button", { name: "Cancel" }).click();
  await expect(model(page).getByRole("button", { name: "Open Claude Code sign-in" })).toBeVisible();
  expect(calls.delete).toEqual(["claude"]);
  await expect(model(page).getByText("Finish signing in")).toHaveCount(0);
});

test("a sign-in that ended with an error while still signed out shows an alert", async ({ page }) => {
  await mockApi(page, { claude: conn(), codex: conn({ login: { running: false, exitCode: 1 } }) }, { defaults: APP });
  await openForm(page);
  await expect(model(page).getByRole("alert")).toHaveText("Sign-in didn't finish. Try again, or run codex login in a terminal.");
  await expect(model(page).getByRole("button", { name: "Open Codex sign-in" })).toBeVisible();
});

test("a failed status check is shown with a way to check again", async ({ page }) => {
  const state: State = { claude: conn({ error: "The sign-in status check failed." }), codex: ready({ method: "chatgpt" }) };
  const calls = await mockApi(page, state);
  await openForm(page);
  await expect(model(page)).toContainText("Status check failed");
  await expect(model(page)).toContainText("The sign-in status check failed.");
  await expect(model(page).getByRole("button", { name: "Open Claude Code sign-in" })).toHaveCount(0);
  const loaded = calls.get;
  state.claude = conn();
  await model(page).getByRole("button", { name: "Check again" }).click();
  await expect.poll(() => calls.get).toBeGreaterThan(loaded);
  await expect(model(page)).toContainText("Not signed in");
});

test("a program that isn't installed links to its install page, and Check again finds it", async ({ page }) => {
  const state: State = { claude: ready(), codex: conn({ installed: false }) };
  await mockApi(page, state, { defaults: APP });
  await openForm(page);
  await expect(model(page)).toContainText("Not installed");
  await expect(model(page).getByRole("link", { name: /Install Codex CLI/ })).toHaveAttribute("href", "https://developers.openai.com/codex/cli");
  state.codex = conn();
  await model(page).getByRole("button", { name: "Check again" }).click();
  await expect(model(page)).toContainText("Not signed in");
  await expect(model(page).getByRole("button", { name: "Open Codex sign-in" })).toBeVisible();
});

test("a signed-in program's Sign out is available in the form too", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { transcriptionOptions: OPTIONS });
  await openForm(page);
  await expect(field(page, "Model")).toBeVisible();
  await expect(model(page).getByRole("button", { name: "Test connection" })).toBeVisible();
  await expect(model(page).getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("Sign out asks first, and Cancel sends nothing", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto("/?view=settings");
  await model(page).getByRole("button", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Sign out of Claude Code?" })).toBeVisible();
  await expect(dialog).toContainText("This signs Claude Code out on this computer, including in your terminal. Transcription with it stops until you sign in again.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.logout).toEqual([]);
  await expect(model(page).getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("confirming Sign out sends a JSON POST, and the form then asks to sign in again", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { transcriptionOptions: OPTIONS });
  await openForm(page);
  await model(page).getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(model(page)).toContainText("Not signed in");
  await expect(model(page).getByRole("button", { name: "Open Claude Code sign-in" })).toBeVisible();
  await expect(field(page, "Model")).toHaveCount(0);
  expect(calls.logout).toEqual(["claude"]);
  expect(calls.logoutBody).toEqual([{}]);
});

test("Test connection shows it is waiting, then the time it took", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { gateTests: true });
  await page.goto("/?view=settings");
  await model(page).getByRole("button", { name: "Test connection" }).click();
  await expect(model(page).getByRole("button", { name: "Testing…" })).toBeDisabled();
  calls.release();
  await expect(model(page).getByRole("status")).toHaveText("Works · replied in 3.2 s");
  await expect(model(page).getByRole("button", { name: "Test connection" })).toBeEnabled();
  expect(calls.tests).toEqual(["claude"]);
  expect(calls.testBody).toEqual([{}]);
});

test("a failed test shows the message", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() },
    { testReply: { ok: false, seconds: 1.4, model: "haiku", message: "Not logged in. Please run /login" } });
  await page.goto("/?view=settings");
  await model(page).getByRole("button", { name: "Test connection" }).click();
  await expect(model(page).getByRole("status")).toHaveText("Not logged in. Please run /login");
});

test("a test the API refuses (another one running) shows the reason", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { testStatus: 409, testReply: { detail: "A test is already running." } });
  await page.goto("/?view=settings");
  await model(page).getByRole("button", { name: "Test connection" }).click();
  await expect(model(page).getByRole("status")).toHaveText("A test is already running.");
});

const updates = (page: Page) => page.locator("section#updates");
const statusLine = (page: Page) => updates(page).locator("p[role=status]");
const copied = (page: Page) => updates(page).locator("span[role=status]");
const AVAILABLE = { ...UP_TO_DATE, current: "v0.1.0", updatable: true };
// The time shown for the check, as this browser formats it.
const checkedTime = (page: Page) => page.evaluate((iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), CHECKED_AT);

const folders = (page: Page) => page.locator("section#folders");
const NOTE_FILES = "Your work itself is in PrestCribe's database: save it as a PrestCribe file from the home page.";

test("the folders list Scans and Results with their paths, an Open folder button each, and the note", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto(ABOUT);
  await expect(folders(page).getByRole("heading", { name: "Where your files are", level: 2 })).toBeVisible();
  await expect(folders(page).locator("code")).toHaveText([FOLDERS.data, FOLDERS.output]);
  await expect(folders(page).getByText("Scans", { exact: true })).toBeVisible();
  await expect(folders(page).getByText("Results", { exact: true })).toBeVisible();
  await expect(folders(page).getByRole("button")).toHaveCount(2);
  for (const name of ["Open folder: scans", "Open folder: results"]) await expect(folders(page).getByRole("button", { name })).toHaveText("Open folder");
  await expect(folders(page)).toContainText(NOTE_FILES);
  await expect(folders(page).locator("input, select, textarea")).toHaveCount(0);
  await expect(folders(page).locator(".text-destructive")).toHaveCount(0);
});

test("each Open folder button sends a POST for its own folder", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto(ABOUT);
  await expect(folders(page).locator("code")).toHaveCount(2);
  await folders(page).getByRole("button", { name: "Open folder: scans" }).click();
  await expect.poll(() => calls.opened).toEqual(["data"]);
  await folders(page).getByRole("button", { name: "Open folder: results" }).click();
  await expect.poll(() => calls.opened).toEqual(["data", "output"]);
  await expect(folders(page).locator(".text-destructive")).toHaveCount(0);
});

test("a folder the server can't open shows its reason in red, until the next try", async ({ page }) => {
  const reason = "Couldn't open the folder: no file manager found.";
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { openError: reason });
  await page.goto(ABOUT);
  await folders(page).getByRole("button", { name: "Open folder: results" }).click();
  await expect(folders(page).getByText(reason)).toHaveClass(/text-destructive/);
  expect(calls.opened).toEqual(["output"]);
  await expect(folders(page).locator("code")).toHaveText([FOLDERS.data, FOLDERS.output]);

  calls.openError = "";
  await folders(page).getByRole("button", { name: "Open folder: scans" }).click();
  await expect(folders(page).getByText(reason)).toHaveCount(0);
  expect(calls.opened).toEqual(["output", "data"]);
});

test("folders that can't be loaded say so in red, with no paths or buttons, and the note stays", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { foldersFail: true });
  await page.goto(ABOUT);
  await expect(folders(page).getByText("The folders couldn't be loaded.")).toHaveClass(/text-destructive/);
  await expect(folders(page).locator("code")).toHaveCount(0);
  await expect(folders(page).getByRole("button")).toHaveCount(0);
  await expect(folders(page)).toContainText(NOTE_FILES);
});

const LATEST_RELEASE = `${RELEASES}/tag/v0.2.0`;
const help = (page: Page) => page.locator("section#help");

test("Help links to how PrestCribe works and where to report a problem, each in a new tab", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { version: UP_TO_DATE });
  await page.goto(ABOUT);
  await expect(help(page).getByRole("heading", { name: "Help", level: 2 })).toBeVisible();
  const links: [string, string | RegExp][] = [["How PrestCribe works", `${REPO}#readme`], ["Report a problem", new RegExp(`^${REPO}/issues/new\\?body=`)]];
  await expect(help(page).getByRole("link")).toHaveText(links.map(([name]) => name));
  for (const [name, href] of links) {
    const link = help(page).getByRole("link", { name });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
});

test("Report a problem opens a new issue with this copy's version info in its body", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() });
  const body = (info: string) => `${REPO}/issues/new?body=${encodeURIComponent(`\n\n---\n${info}`)}`;
  const report = help(page).getByRole("link", { name: "Report a problem" });
  await page.goto(ABOUT);
  await expect(report).toHaveAttribute("href",
    `${REPO}/issues/new?body=%0A%0A---%0APrestCribe%20v0.2.0%0AWindows%2011%0APython%203.12.4%0APage%20sorting%20on%20this%20computer%3A%20available`);

  calls.versionBody = { ...UP_TO_DATE, current: null, latest: "v0.3.0", system: { os: "macOS 15.1", python: "3.11.9", pytorch: false } };
  await updates(page).getByRole("button", { name: "Check again" }).click();
  await expect(report).toHaveAttribute("href",
    body("PrestCribe (not installed from a release)\nmacOS 15.1\nPython 3.11.9\nPage sorting on this computer: not available"));
});

test("About names PrestCribe and its version and says this copy is up to date and when it was checked, with no Update now", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto(ABOUT);
  await expect(updates(page).getByRole("heading", { name: "PrestCribe v0.2.0", level: 2 })).toBeVisible();
  await expect(updates(page).getByRole("heading", { level: 2 }).locator("span")).toHaveText("v0.2.0");
  await expect(updates(page)).toContainText("Made by IT Project Team 4 at the University of Melbourne, for the University of Melbourne Archives.");
  await expect(updates(page).locator("img")).toHaveAttribute("src", "/favicon.svg");
  await expect(statusLine(page)).toHaveText(`Up to date · checked at ${await checkedTime(page)}.`);
  await expect(updates(page).getByRole("button")).toHaveText(["Check again", "Copy version info"]);
  await expect(updates(page).getByRole("button", { name: "Update now" })).toHaveCount(0);
  await expect(updates(page).locator("details")).toHaveCount(0);
  await expect(copied(page)).toHaveText("");
});

test("while the version is being checked it says so and Check again is disabled; if it can't be reached it says so and Check again recovers", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { versionFails: true });
  const check = updates(page).getByRole("button", { name: "Check again" });
  const release = calls.holdVersion();
  await page.goto(ABOUT);
  await expect(statusLine(page)).toHaveText("Checking for updates…");
  await expect(check).toBeDisabled();
  await expect(updates(page).getByRole("heading", { level: 2 })).toHaveText("PrestCribe");
  release();

  await expect(statusLine(page)).toHaveText("Couldn't check for updates.");
  await expect(check).toBeEnabled();
  await expect(updates(page).getByRole("button")).toHaveText(["Check again"]); // nothing to copy or update yet
  await expect(updates(page).getByRole("button", { name: "Copy version info" })).toHaveCount(0);
  await expect(updates(page).getByRole("link", { name: /What's new/ })).toHaveCount(0); // not until the check has answered
  await expect(help(page).getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", `${REPO}/issues/new`);

  calls.versionFails = false;
  const asked = calls.versions;
  await check.click();
  await expect(statusLine(page)).toHaveText(`Up to date · checked at ${await checkedTime(page)}.`);
  expect(calls.versions).toBe(asked + 1);
  await expect(updates(page).getByRole("heading", { name: "PrestCribe v0.2.0", level: 2 })).toBeVisible();
  await expect(updates(page).getByRole("button")).toHaveText(["Check again", "Copy version info"]);
  await expect(updates(page).getByRole("link", { name: "What's new in v0.2.0" })).toHaveAttribute("href", LATEST_RELEASE);
});

test("Check again asks for the version again and shows what it finds", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { version: AVAILABLE });
  await page.goto(ABOUT);
  await expect(statusLine(page)).toHaveText("v0.2.0 is available.");
  const asked = calls.versions;
  const release = calls.holdVersion();
  calls.versionBody = { ...AVAILABLE, current: "v0.2.0", updatable: false };
  await updates(page).getByRole("button", { name: "Check again" }).click();
  await expect(statusLine(page)).toHaveText("Checking for updates…");
  await expect(updates(page).getByRole("button", { name: "Check again" })).toBeDisabled();
  await expect(updates(page).getByRole("button", { name: "Update now" })).toBeVisible(); // the last answer stays until the new one arrives
  release();
  await expect(statusLine(page)).toHaveText(`Up to date · checked at ${await checkedTime(page)}.`);
  expect(calls.versions).toBe(asked + 1);
  await expect(updates(page).getByRole("button", { name: "Update now" })).toHaveCount(0);
  await expect(updates(page).getByRole("heading", { name: "PrestCribe v0.2.0", level: 2 })).toBeVisible();
});

// The clipboard's text, its line breaks as \n (Windows keeps them as \r\n there).
const clipboard = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");

test("Copy version info puts the version and the computer's details on the clipboard and says Copied.", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto(ABOUT);
  await expect(copied(page)).toHaveText("");
  await updates(page).getByRole("button", { name: "Copy version info" }).click();
  await expect(copied(page)).toHaveText("Copied.");
  expect(await clipboard(page)).toBe("PrestCribe v0.2.0\nWindows 11\nPython 3.12.4\nPage sorting on this computer: available");
});

test("a copy not installed from a release copies that, and a computer without PyTorch says page sorting isn't available", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const system = { os: "Ubuntu 24.04", python: "3.12.3", pytorch: false };
  await mockApi(page, { claude: ready(), codex: conn() }, { version: { ...UP_TO_DATE, current: null, system } });
  await page.goto(ABOUT);
  await updates(page).getByRole("button", { name: "Copy version info" }).click();
  await expect(copied(page)).toHaveText("Copied.");
  expect(await clipboard(page)).toBe("PrestCribe (not installed from a release)\nUbuntu 24.04\nPython 3.12.3\nPage sorting on this computer: not available");
});

test("when the browser refuses the copy it says Couldn't copy it.", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await mockApi(page, { claude: ready(), codex: conn() });
  await page.goto(ABOUT);
  await updates(page).getByRole("button", { name: "Copy version info" }).click();
  await expect(copied(page)).toHaveText("Couldn't copy it.");
  await updates(page).getByRole("button", { name: "Check again" }).click();
  await expect(copied(page)).toHaveText("");
});

test("About offers the newer release; Update now asks first, then sends the update and says PrestCribe closes", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { version: { ...AVAILABLE, latest: "v0.3.0" } });
  const asked: string[] = [];
  let accept = false;
  page.on("dialog", (dialog) => { asked.push(dialog.message()); return accept ? dialog.accept() : dialog.dismiss(); });
  await page.goto(ABOUT);
  await expect(updates(page).getByRole("heading", { name: "PrestCribe v0.1.0", level: 2 })).toBeVisible();
  await expect(statusLine(page)).toHaveText("v0.3.0 is available.");
  await expect(updates(page)).not.toContainText("Up to date");
  await expect(updates(page).getByRole("button")).toHaveText(["Update now", "Check again", "Copy version info"]);
  await updates(page).getByRole("button", { name: "Update now" }).click();
  await expect.poll(() => asked).toEqual(["Update to v0.3.0? PrestCribe closes, updates in a new window, then opens again."]);
  expect(calls.updates).toBe(0);
  await expect(updates(page).getByRole("button", { name: "Update now" })).toBeVisible();

  accept = true;
  await updates(page).getByRole("button", { name: "Update now" }).click();
  await expect(statusLine(page)).toHaveText("Updating: PrestCribe closes now, updates in a new window, then opens again.");
  expect(calls.updates).toBe(1);
  await expect(updates(page).getByRole("button")).toHaveText(["Copy version info"]); // nothing else to press while it updates
  await expect(updates(page)).not.toContainText("is available");
});

test("while updating it asks for the version every 5 s and reloads once PrestCribe answers again", async ({ page }) => {
  await page.clock.install();
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { version: { ...AVAILABLE, latest: "v0.3.0" } });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(ABOUT);
  await updates(page).getByRole("button", { name: "Update now" }).click();
  await expect(statusLine(page)).toHaveText("Updating: PrestCribe closes now, updates in a new window, then opens again.");
  calls.versionFails = true;
  const asked = calls.versions;
  await page.clock.runFor(5000);
  await expect.poll(() => calls.versions).toBe(asked + 1);
  await expect(statusLine(page)).toHaveText("Updating: PrestCribe closes now, updates in a new window, then opens again.");

  calls.versionFails = false;
  calls.versionBody = { ...UP_TO_DATE, current: "v0.3.0", latest: "v0.3.0" };
  const reloaded = page.waitForEvent("load");
  await page.clock.runFor(5000);
  await reloaded;
  await expect(updates(page).getByRole("heading", { name: "PrestCribe v0.3.0", level: 2 })).toBeVisible();
});

test("an update that hasn't finished after 3 minutes says so, points to the install line, and offers Check again", async ({ page }) => {
  await page.clock.install();
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { version: { ...AVAILABLE, latest: "v0.3.0" } });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(ABOUT);
  await updates(page).getByRole("button", { name: "Update now" }).click();
  await expect(statusLine(page)).toHaveText("Updating: PrestCribe closes now, updates in a new window, then opens again.");
  calls.versionFails = true;
  await page.clock.runFor(3 * 60 * 1000);
  await expect(statusLine(page)).toHaveText("The update didn't finish. Running the install line from the README again fixes it.");
  await expect(updates(page).getByRole("button", { name: "Check again" })).toBeEnabled();

  calls.versionFails = false;
  await updates(page).getByRole("button", { name: "Check again" }).click();
  await expect(statusLine(page)).toHaveText("v0.3.0 is available.");
});

test("an update the server refuses shows its reason and keeps Update now", async ({ page }) => {
  const calls = await mockApi(page, { claude: ready(), codex: conn() }, { version: { ...AVAILABLE, latest: "v0.3.0" }, updateStatus: 400 });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(ABOUT);
  await updates(page).getByRole("button", { name: "Update now" }).click();
  await expect(statusLine(page)).toHaveText("v0.3.0 is available. This copy wasn't installed from a release: update it with git pull.");
  expect(calls.updates).toBe(1);
  await expect(updates(page)).not.toContainText("Updating:");
  await expect(updates(page).getByRole("button", { name: "Update now" })).toBeVisible();
  await expect(updates(page).getByRole("button", { name: "Check again" })).toBeEnabled();
});

test("a copy not installed from a release is told it is updated with git, and shows the latest release", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { version: { ...UP_TO_DATE, current: null, latest: "v0.3.0" } });
  await page.goto(ABOUT);
  await expect(statusLine(page)).toHaveText("Latest release: v0.3.0. A copy not installed from a release is updated with git.");
  await expect(updates(page).getByRole("heading", { level: 2 })).toHaveText("PrestCribe");
  await expect(updates(page)).not.toContainText("PrestCribe v");
  await expect(updates(page).getByRole("button")).toHaveText(["Check again", "Copy version info"]);
  await expect(updates(page).getByRole("link", { name: "What's new in v0.3.0" })).toHaveAttribute("href", `${RELEASES}/tag/v0.3.0`);
});

test("when GitHub can't be reached About shows the error in place of the latest release", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() },
    { version: { ...UP_TO_DATE, current: "v0.1.0", latest: null, error: "Couldn't reach GitHub to check for updates." } });
  await page.goto(ABOUT);
  await expect(updates(page).getByRole("heading", { name: "PrestCribe v0.1.0", level: 2 })).toBeVisible();
  await expect(statusLine(page)).toHaveText("Couldn't reach GitHub to check for updates.");
  await expect(updates(page)).not.toContainText("Up to date");
  await expect(updates(page).getByRole("button")).toHaveText(["Check again", "Copy version info"]);
  const link = updates(page).getByRole("link", { name: "What's new", exact: true }); // no latest release to name, so all of them
  await expect(link).toHaveAttribute("href", RELEASES);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("What's new links to the latest release's notes on GitHub, in a new tab", async ({ page }) => {
  await mockApi(page, { claude: ready(), codex: conn() }, { version: UP_TO_DATE });
  await page.goto(ABOUT);
  const link = updates(page).getByRole("link", { name: "What's new in v0.2.0" });
  await expect(link).toHaveAttribute("href", LATEST_RELEASE);
  await expect(link).toHaveAttribute("target", "_blank");
});
