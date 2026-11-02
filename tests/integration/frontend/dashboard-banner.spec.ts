import { test, expect, type Page } from "@playwright/test";
import { serveItems } from "./items-mock";

// The API is intercepted: no requests reach the real backend, and the real claude and codex programs are never run.
const choice = { provider: "claude", model: "sonnet", effort: "high" };
const connection = (signedIn: boolean) => ({
  installed: true, signedIn, method: signedIn ? "claude.ai" : null, plan: null, version: null, warnings: [], error: null,
  login: { running: false, exitCode: null },
});
type Mock = {
  configured?: typeof choice | null;
  claude?: boolean; // signed in
  codex?: boolean;
  models?: number; // failing status of GET /transcription-models
  connections?: number; // failing status of GET /connections
  keys?: Record<string, boolean>; // GET /api-keys: provider -> a key is saved
  keysStatus?: number; // failing status of GET /api-keys
  environment?: string[]; // providers whose key comes from the computer's settings
  growing?: boolean; // the items come with one more page on every call, so a finished refresh shows in the stats
};

async function mock(page: Page, options: Mock = {}) {
  const calls = { models: 0, connections: 0, keys: 0, progress: 0 };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const served = serveItems(() => {
      calls.progress++;
      const pages = Array.from({ length: options.growing ? calls.progress : 1 }, (_, i) => (
        { id: `b/p${i + 1}`, label: `Pg ${i + 1}`, category: "Coded", status: "Ready to review", flagCount: 0, surveyId: "s", reviewPageId: `b/p${i + 1}` }));
      return [{ bundle: "b", name: "b", pages }];
    }, route.request());
    if (served) return route.fulfill(served);
    if (path === "/api/transcription-models") {
      calls.models++;
      if (options.models) return route.fulfill({ status: options.models, json: { detail: "failed" } });
      return route.fulfill({ json: { configured: options.configured === undefined ? choice : options.configured, models: [] } });
    }
    if (path === "/api/connections") {
      calls.connections++;
      if (options.connections) return route.fulfill({ status: options.connections, json: { detail: "failed" } });
      return route.fulfill({ json: { claude: connection(options.claude ?? true), codex: connection(options.codex ?? false) } });
    }
    if (path === "/api/api-keys") {
      calls.keys++;
      if (options.keysStatus) return route.fulfill({ status: options.keysStatus, json: { detail: "failed" } });
      return route.fulfill({ json: ["gemini", "anthropic", "openai", "openrouter"].map((provider) => ({
        provider, label: provider, keysUrl: "https://example.com/keys", needsKey: true,
        saved: options.keys?.[provider] ?? false, fromEnvironment: options.environment?.includes(provider) ?? false }))
        .concat([{ provider: "ollama", label: "Ollama", keysUrl: "https://ollama.com/download", needsKey: false, saved: false, fromEnvironment: false }]) });
    }
    return route.fulfill({ status: 404, json: { detail: `Unexpected test request: ${path}` } });
  });
  return calls;
}

const banner = (page: Page) => page.getByRole("status").filter({ hasText: /isn't set up yet|isn't signed in|has no key/ });
const stat = (page: Page) => page.getByTestId("stat-total-pages");
const NOT_SET_UP = "Transcription isn't set up yet. Choose a model in Settings to start transcribing.";

for (const [view, url] of [["all-items", "/?series=1"], ["item page", "/?series=1&item=b"]] as const) {
  test(`${view} view: no model chosen shows the setup banner above the stats`, async ({ page }) => {
    await mock(page, { configured: null });
    await page.goto(url);
    await expect(banner(page)).toHaveText(`${NOT_SET_UP}Open Settings`);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(stat(page)).toHaveText("1");
    const [b, s] = [await banner(page).boundingBox(), await stat(page).boundingBox()];
    expect(b!.y).toBeLessThan(s!.y);
  });

  test(`${view} view: a chosen provider that isn't signed in shows the banner`, async ({ page }) => {
    await mock(page, { configured: { ...choice, provider: "codex" }, claude: true, codex: false });
    await page.goto(url);
    await expect(banner(page)).toHaveText("Codex CLI isn't signed in, so transcription won't work yet.Open Settings");
  });
}

test("the banner names Claude Code when it is the chosen provider", async ({ page }) => {
  await mock(page, { claude: false, codex: true });
  await page.goto("/?series=1");
  await expect(banner(page)).toContainText("Claude Code isn't signed in, so transcription won't work yet.");
});

test("an API provider without a key shows the banner, and one with a key saved or set on the computer doesn't", async ({ page }) => {
  const openai = { ...choice, provider: "openai", model: "gpt-x", effort: "default" };
  await mock(page, { configured: openai });
  await page.goto("/?series=1");
  await expect(banner(page)).toHaveText("OpenAI API has no key, so transcription won't work yet.Open Settings");

  for (const options of [{ keys: { openai: true } }, { environment: ["openai"] }]) {
    const calls = await mock(page, { configured: openai, ...options });
    await page.goto("/?series=1");
    await expect(stat(page)).toHaveText("1");
    await expect.poll(() => calls.keys).toBe(1);
    await expect(banner(page)).toHaveCount(0);
  }
});

test("Ollama needs no key, so there is no banner for it", async ({ page }) => {
  await mock(page, { configured: { provider: "ollama", model: "llama3.2-vision", effort: "default" } });
  await page.goto("/?series=1");
  await expect(stat(page)).toHaveText("1");
  await expect(banner(page)).toHaveCount(0);
});

test("the banner still shows for a program that isn't signed in when the keys can't be loaded", async ({ page }) => {
  await mock(page, { claude: false, keysStatus: 500 });
  await page.goto("/?series=1");
  await expect(banner(page)).toContainText("Claude Code isn't signed in, so transcription won't work yet.");
});

test("no banner when the chosen provider is signed in, even if the other one is not", async ({ page }) => {
  const calls = await mock(page, { claude: true, codex: false });
  await page.goto("/?series=1");
  await expect(stat(page)).toHaveText("1");
  await expect.poll(() => calls.connections).toBe(1);
  await expect(banner(page)).toHaveCount(0);
});

for (const [name, options] of [
  ["/connections fails", { connections: 500 }],
  ["/transcription-models fails", { models: 500 }],
  ["both are missing (404)", { models: 404, connections: 404 }],
] as const) {
  test(`no banner and a working dashboard when ${name}`, async ({ page }) => {
    const calls = await mock(page, { configured: null, ...options });
    await page.goto("/?series=1");
    await expect(stat(page)).toHaveText("1");
    await expect.poll(() => calls.models + calls.connections).toBeGreaterThanOrEqual(2);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Settings" })).toHaveCount(0);
  });
}

test("Open Settings goes to the settings page", async ({ page }) => {
  await mock(page, { configured: null });
  await page.goto("/?series=1");
  const link = banner(page).getByRole("link", { name: "Open Settings" });
  await expect(link).toHaveAttribute("href", "/?view=settings");
  await link.click();
  await expect(page).toHaveURL(/\/\?view=settings$/);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
});

test("setup is requested once on load, not on the progress poll, and on focus at most every 30 s", async ({ page }) => {
  await page.clock.install();
  const calls = await mock(page, { configured: null, growing: true });
  await page.goto("/?series=1");
  await expect(banner(page)).toBeVisible();
  expect(calls).toMatchObject({ models: 1, connections: 1, keys: 1 });

  // A poll is skipped while the previous refresh is still loading, so wait for each refresh to show before the next tick.
  await expect.poll(async () => (await stat(page).textContent()) === String(calls.progress)).toBe(true);
  const shown = calls.progress;
  for (const n of [1, 2]) {
    await page.clock.runFor(5000);
    await expect(stat(page)).toHaveText(String(shown + n));
  }
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); // within 30 s of the first check
  await Promise.all([page.waitForRequest("**/api/sync"), page.evaluate(() => fetch("/api/sync").catch(() => {}))]);
  expect(calls).toMatchObject({ models: 1, connections: 1, keys: 1 });

  await page.clock.runFor(30000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => calls.connections).toBe(2);
  expect(calls.models).toBe(2);
});
