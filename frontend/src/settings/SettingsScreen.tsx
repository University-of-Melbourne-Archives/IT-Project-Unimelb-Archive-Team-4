import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import AppHeader from "@/components/AppHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { backendRequest, hasKey, keyStatus, modelsOf, type ApiKey, type ProviderOptions } from "../progress/backend";
import { KeyForm } from "./ApiKeys";
import About from "./About";
import TranscriptionDefaults from "./TranscriptionDefaults";

type Connection = {
  installed: boolean; signedIn: boolean; method: string | null; plan: string | null; version: string | null;
  warnings: string[]; error: string | null; login: { running: boolean; exitCode: number | null };
};
type Connections = Record<"claude" | "codex", Connection>;
type TestState = { running: boolean; result?: { ok: boolean; seconds: number; model: string; message: string }; error?: string };
const jsonPost = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };

const providers = [
  { id: "claude", name: "Claude Code", signIn: "Open Claude Code sign-in", command: "claude auth login",
    install: "https://code.claude.com/docs/en/setup", usage: "https://claude.ai/settings/usage" },
  { id: "codex", name: "Codex CLI", signIn: "Open Codex sign-in", command: "codex login",
    install: "https://developers.openai.com/codex/cli", usage: "https://chatgpt.com/codex/settings/usage" },
] as const;

// "<plan> · <version>" under the card title; parts that are unknown are left out.
function subtitle(c: Connection): string {
  const plan = !c.signedIn ? null : c.method === "api_key" ? "API key" : c.method === "chatgpt" ? "ChatGPT plan"
    : c.plan ? `${c.plan[0].toUpperCase() + c.plan.slice(1)} plan` : null;
  return [plan, c.version].filter(Boolean).join(" · ");
}
const TEST_NOTE = "Sends one tiny request on your plan.";

const TABS = ["transcription", "about"];

// Settings in tabs, the one shown kept in the URL (?tab=): Model (the transcription model, which also sorts pages, and how it's
// connected) and About (the version and updates, where this copy keeps its files, help); they stay loaded.
export default function SettingsScreen() {
  const [tab, setTab] = useState(() => TABS.find((t) => t === new URLSearchParams(location.search).get("tab")) ?? "transcription");
  function show(next: string) {
    const url = new URL(location.href);
    url.searchParams.set("tab", next);
    url.hash = "";
    history.replaceState(null, "", url);
    setTab(next);
  }
  const [data, setData] = useState<Connections | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState<(typeof providers)[number] | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[] | null>(null);
  const [keysError, setKeysError] = useState("");
  const [keysVersion, setKeysVersion] = useState(0); // a key saved or removed: the model lists load again
  const keysChanged = useCallback((keys: ApiKey[]) => { setApiKeys(keys); setKeysVersion((n) => n + 1); }, []);
  useEffect(() => {
    backendRequest<ApiKey[]>("/api-keys").then(keysChanged)
      .catch((e) => setKeysError(e instanceof Error ? e.message : "Could not load the API keys."));
  }, [keysChanged]);
  const [tests, setTests] = useState<Partial<Record<string, TestState>>>({});
  const polling = Boolean(data && (data.claude.login.running || data.codex.login.running));

  // Only the latest request may set the state, so a slow older reply can't undo a newer one.
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    return backendRequest<Connections>("/connections").then((result) => {
      if (mine !== latest.current) return;
      setData(result);
      setLoadError("");
    }).catch((e) => {
      if (mine === latest.current) setLoadError(e instanceof Error ? e.message : "Could not load sign-in status.");
    });
  }, []);

  // Load on open and when the window regains focus (after signing in elsewhere).
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  // Poll only while a sign-in is running.
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [polling, load]);

  async function login(provider: string, method: "POST" | "DELETE") {
    setBusy(true);
    setActionError("");
    try {
      await backendRequest(`/connections/${provider}/login`, method === "POST" ? jsonPost : { method });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Request failed.");
    }
    await load();
    setBusy(false);
  }

  async function signOut(provider: string) {
    setBusy(true);
    setActionError("");
    try {
      await backendRequest(`/connections/${provider}/logout`, jsonPost);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Request failed.");
    }
    setSigningOut(null);
    setTests((t) => ({ ...t, [provider]: undefined }));
    await load();
    setBusy(false);
  }

  async function test(provider: string) {
    setTests((t) => ({ ...t, [provider]: { running: true } }));
    try {
      const result = await backendRequest<NonNullable<TestState["result"]>>(`/connections/${provider}/test`, jsonPost);
      setTests((t) => ({ ...t, [provider]: { running: false, result } }));
    } catch (e) {
      setTests((t) => ({ ...t, [provider]: { running: false, error: e instanceof Error ? e.message : "Request failed." } }));
    }
  }

  // Pages are sorted by the transcription model: a saved sorting method or sorting model of its own is put back to it.
  useEffect(() => {
    backendRequest<{ method: string; sorter: unknown }>("/page-sorting").then((s) => {
      if (s.method !== "model" || s.sorter) {
        return backendRequest("/page-sorting", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "model", sameAsTranscription: true }) });
      }
    }).catch(() => {}); // tried again the next time Settings opens
  }, []);

  // Each provider's models, loaded again when a key changes, Ollama is checked again, or a program is installed or signed in.
  const programs = data ? providers.map((p) => `${data[p.id].installed}${data[p.id].signedIn}`).join() : "";
  const [options, setOptions] = useState<Record<string, ProviderOptions> | null | undefined>(undefined);
  useEffect(() => {
    backendRequest<Record<string, ProviderOptions>>("/transcription-options").then(setOptions).catch(() => setOptions(null));
  }, [keysVersion, programs]);

  // Whether each provider is connected (undefined: not known yet): signed in, a key, or for Ollama, models listed.
  const ready: Record<string, boolean | undefined> = { claude: data?.claude.signedIn, codex: data?.codex.signedIn,
    ...Object.fromEntries((apiKeys ?? []).filter((k) => k.needsKey).map((k) => [k.provider, hasKey(k)])),
    ollama: options === undefined ? undefined : Boolean(modelsOf(options?.ollama)) };

  // A signed-in program's install, sign-in, test and sign-out.
  function programBody(p: (typeof providers)[number], c: Connection) {
    const code = <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{p.command}</code>;
    const canSignIn = c.installed && !c.error && !c.signedIn;
    const subscription = c.method === "claude.ai" || c.method === "chatgpt";
    const t = tests[p.id];
    return (
      <>
        {c.warnings.map((w) => (
          <Alert key={w}><AlertDescription>{w}</AlertDescription></Alert>
        ))}
        {!c.installed && (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href={p.install} target="_blank" rel="noopener noreferrer">Install {p.name}</a>
            </Button>
            <Button variant="outline" onClick={load}>Check again</Button>
          </div>
        )}
        {c.error && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {c.error} <Button variant="outline" size="sm" onClick={load}>Check again</Button>
          </div>
        )}
        {c.installed && !c.error && c.signedIn && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" disabled={t?.running || busy} aria-describedby={`${p.id}-test-note`} onClick={() => test(p.id)}>
                    {t?.running && <Spinner role="presentation" aria-hidden="true" />} Test connection
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>{TEST_NOTE}</TooltipContent>
              </Tooltip>
              <span id={`${p.id}-test-note`} className="sr-only">{TEST_NOTE}</span>
              {subscription && (
                <Button asChild variant="outline">
                  <a href={p.usage} target="_blank" rel="noopener noreferrer">Check usage</a>
                </Button>
              )}
              <Button variant="ghost" className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy}
                onClick={() => setSigningOut(p)}>Sign out</Button>
            </div>
            {t?.running && <p role="status" className="text-sm text-muted-foreground">Waiting for a reply…</p>}
            {t?.result?.ok && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                <Check className="size-4" /> Works · replied in {t.result.seconds} s ({t.result.model})
              </p>
            )}
            {t?.result && !t.result.ok && <Alert variant="destructive"><AlertDescription>{t.result.message}</AlertDescription></Alert>}
            {t?.error && <Alert variant="destructive"><AlertDescription>{t.error}</AlertDescription></Alert>}
          </div>
        )}
        {c.login.running && !c.signedIn ? (
          <div className="space-y-2 text-sm">
            <p role="status" className="flex items-center gap-2">
              <Spinner role="presentation" aria-hidden="true" />
              Finish signing in in the browser window that opened.
            </p>
            <Button variant="outline" disabled={busy} onClick={() => login(p.id, "DELETE")}>Cancel</Button>
            <p className="text-xs text-muted-foreground">
              Browser didn't open? Run {code} in a terminal, then come back.
            </p>
          </div>
        ) : (
          <>
            {c.login.exitCode !== null && c.login.exitCode !== 0 && !c.signedIn && (
              <Alert variant="destructive">
                <AlertDescription>
                  Sign-in didn't finish. Try again, or run {code} in a terminal.
                </AlertDescription>
              </Alert>
            )}
            {canSignIn && (
              <Button disabled={busy} onClick={() => login(p.id, "POST")}>{p.signIn}</Button>
            )}
          </>
        )}
      </>
    );
  }

  // A connected provider's own links: test, check usage of or sign out of a program (with its warnings), or remove a saved key.
  function manage(id: string) {
    const program = providers.find((p) => p.id === id);
    const c = program && data?.[program.id];
    if (program && c?.signedIn) {
      const t = tests[program.id];
      const subscription = c.method === "claude.ai" || c.method === "chatgpt";
      return (
        <span className="block space-y-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" className="underline underline-offset-4" disabled={t?.running} title={TEST_NOTE} onClick={() => test(program.id)}>
              {t?.running ? "Testing…" : "Test connection"}
            </button>
            {subscription && <a className="underline underline-offset-4" href={program.usage} target="_blank" rel="noopener noreferrer">Check usage</a>}
            <button type="button" className="text-destructive underline underline-offset-4" disabled={busy} onClick={() => setSigningOut(program)}>Sign out</button>
          </span>
          <span role="status" className="block">
            {t?.result && <span className={t.result.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}>{t.result.ok ? `Works · replied in ${t.result.seconds} s` : t.result.message}</span>}
            {t?.error && <span className="text-destructive">{t.error}</span>}
          </span>
          {c.warnings.map((w) => <span key={w} className="block text-amber-700 dark:text-amber-300">{w}</span>)}
        </span>
      );
    }
    const key = apiKeys?.find((k) => k.provider === id);
    if (!key?.saved) return null;
    return <button type="button" className="text-destructive underline underline-offset-4" onClick={() => removeKey(key)}>Remove key</button>;
  }

  async function removeKey(key: ApiKey) {
    if (!confirm(`Remove the ${key.label} key saved on this computer?`)) return;
    setActionError("");
    try {
      keysChanged(await backendRequest<ApiKey[]>(`/api-keys/${key.provider}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "" }) }));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not remove the key.");
    }
  }

  // What connecting a provider still needs: a program's install or sign-in, an API key, or Ollama running.
  function connect(id: string) {
    const program = providers.find((p) => p.id === id);
    if (program) {
      const c = data?.[program.id];
      if (!c) {
        return loadError ? <p className="text-destructive">{loadError}</p>
          : <p className="flex items-center gap-2 text-muted-foreground"><Spinner role="presentation" aria-hidden="true" /> Checking sign-in…</p>;
      }
      const status = !c.installed ? "Not installed" : c.error ? "Status check failed"
        : c.signedIn ? ["Signed in", subtitle(c)].filter(Boolean).join(" · ") : "Not signed in";
      return <><p className="font-medium">{status}</p>{programBody(program, c)}</>;
    }
    if (id !== "ollama") {
      const key = apiKeys?.find((k) => k.provider === id);
      if (key) return <><p className="font-medium">{keyStatus(key)}</p><KeyForm k={key} onChange={keysChanged} /></>;
      return keysError ? <p className="text-destructive">{keysError}</p>
        : <p className="flex items-center gap-2 text-muted-foreground"><Spinner role="presentation" aria-hidden="true" /> Checking keys…</p>;
    }
    const found = modelsOf(options?.ollama)?.length ?? 0;
    return (
      <>
        {found ? <p className="font-medium">Running · {found} {found === 1 ? "model" : "models"}</p>
          : <p>Install Ollama, then download a model that reads images, like llama3.2-vision. Keep it running.</p>}
        <div className="flex flex-wrap gap-2">
          {!found && <Button asChild variant="outline"><a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Get Ollama</a></Button>}
          <Button variant="ghost" onClick={() => setKeysVersion((n) => n + 1)}>Check again</Button>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader crumbs={[{ label: "Settings" }]} />
      <TooltipProvider>
        <main className="space-y-8 p-6">
          <div className="flex flex-col gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
              <p className="text-sm text-muted-foreground">How pages are read, and the accounts that read them</p>
            </div>
          </div>
          <Tabs value={tab} onValueChange={show} className="gap-6">
            <TabsList aria-label="Settings">
              <TabsTrigger value="transcription">Model</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
            </TabsList>
            <TabsContent value="transcription" forceMount className="space-y-8 data-[state=inactive]:hidden">
          {loadError && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                {loadError} <Button variant="outline" size="sm" onClick={load}>Try again</Button>
              </AlertDescription>
            </Alert>
          )}
          {keysError && <Alert variant="destructive"><AlertDescription>{keysError}</AlertDescription></Alert>}
          {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
          <TranscriptionDefaults options={options} ready={ready} connect={connect} manage={manage} />
            </TabsContent>
            <TabsContent value="about" forceMount className="space-y-8 data-[state=inactive]:hidden">
              <About />
            </TabsContent>
          </Tabs>
        </main>
      </TooltipProvider>
      <Dialog open={signingOut !== null} onOpenChange={(open) => { if (!open && !busy) setSigningOut(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sign out of {signingOut?.name}?</DialogTitle>
            <DialogDescription>
              This signs {signingOut?.name} out on this computer, including in your terminal. Transcription with it stops until you sign in again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setSigningOut(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => signingOut && signOut(signingOut.id)}>Sign out</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
