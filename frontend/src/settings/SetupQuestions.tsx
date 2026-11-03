import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, ScanSearch } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { navigate } from "../navigate";
import { me } from "../person";
import { backendRequest, itemTitle, providerBlurbs, providerNames, type ArchiveItem, type ProviderOptions } from "../progress/backend";
import { isSetUp, setUpSteps, type SeriesCounts } from "../progress/setup";
import type { Collection, PageType } from "./PageTypesScreen";
import { Fields, type Row } from "./Fields";
import { partsOf } from "./shapes";

type Choice = { provider: string; model: string; effort: string };
type Suggestion = { label: string; description: string; pages: number[] };
// What looking at a sample said: the item, the kinds of page the model saw in it with the pages of each, and what was answered
// for each kind, by its label. Kept in this browser until answered (asking again costs a model call).
type Looked = { item: string; types: Suggestion[]; answered: Record<string, string> };
type Answer = { kind: "new"; label: string } | { kind: "is"; type: PageType } | { kind: "skip" };
type Labels = Record<string, string>; // page number -> its kind of page

const LOOK = 30; // pages shown to the model at once, the most it takes
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const start = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// Setting a series up as questions to answer, in order: what kinds of page it has (a model looks at a sample item's pages and
// groups them by look; one answer a group), what to write down from each, and what one record is; beside them, the setup steps
// (reading a sample item is done on its Items page). An answered question shows what it says, and can be answered again.
export default function SetupQuestions({ collectionId, collection, types, onChanged }: {
  collectionId: number; collection: Collection & SeriesCounts; types: PageType[]; onChanged: () => void;
}) {
  const kept = `prestcribe.looked.${collectionId}`;
  const [looked, setLooked] = useState<Looked | null>(() => { try { return JSON.parse(localStorage.getItem(kept) ?? "null"); } catch { return null; } });
  useEffect(() => { try { localStorage.setItem(kept, JSON.stringify(looked)); } catch { /* kept for this visit only */ } }, [kept, looked]);
  const [items, setItems] = useState<{ name: string; archive: ArchiveItem | null }[] | null>(null);
  const [item, setItem] = useState(looked?.item ?? "");
  const [labels, setLabels] = useState<Labels>({});
  const [drafts, setDrafts] = useState<Record<string, Row[]>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [changes, setChanges] = useState(0);
  // The model that looks: the series' own sorting model, else the transcription one at its lowest effort.
  const [sorter, setSorter] = useState<Choice | null>(null);
  const [configured, setConfigured] = useState<Choice | null | undefined>(undefined);
  const [options, setOptions] = useState<Record<string, ProviderOptions> | null>(null);
  const [asking, setAsking] = useState(false);
  const [listing, setListing] = useState(0); // asked for again every few seconds while it has none: they may be being added
  const [recordSaid, setRecordSaid] = useState(""); // where one record starts, as saved here
  useEffect(() => {
    backendRequest<{ items: { name: string; archive: ArchiveItem | null }[] }>(`/collections/${collectionId}/items?page=0&size=100`)
      .then((listed) => {
        const archived = listed.items.filter((i) => i.archive); // only the archive's items have scans to fetch
        setItems(archived);
        setItem((chosen) => chosen || archived[0]?.name || "");
      }).catch((e) => setError(message(e, "Could not load the series' items.")));
  }, [collectionId, listing]);
  useEffect(() => {
    if (!items || items.length) return;
    const timer = window.setInterval(() => setListing((n) => n + 1), 5000);
    return () => window.clearInterval(timer);
  }, [items]);
  useEffect(() => {
    backendRequest<{ sorter: Choice | null }>(`/collections/${collectionId}/page-sorting`).then((r) => setSorter(r.sorter)).catch(() => {});
    backendRequest<{ configured: Choice | null }>("/transcription-models").then((r) => setConfigured(r.configured)).catch(() => setConfigured(null));
    backendRequest<Record<string, ProviderOptions>>("/transcription-options").then(setOptions).catch(() => {});
  }, [collectionId]);
  useEffect(() => {
    if (!looked) return;
    backendRequest<Labels>(`/collections/${collectionId}/items/${looked.item}/labels`).then(setLabels).catch(() => {});
  }, [collectionId, looked, changes]);

  const offered = (c: Choice) => options?.[c.provider]?.models.find((m) => m.value === c.model);
  const lowest = (c: Choice) => {
    const efforts = offered(c)?.efforts?.length ? offered(c)!.efforts! : options?.[c.provider]?.efforts ?? [];
    return efforts.includes("low") ? "low" : offered(c)?.defaultEffort ?? c.effort;
  };
  const asker: Choice | null = sorter ?? (configured ? { ...configured, effort: lowest(configured) } : null);
  const named = (c: Choice) => {
    const label = offered(c)?.label ?? c.model;
    const id = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(label);
    return id ? `${start(id[1])} ${id[2]}.${id[3]}` : label;
  };
  const title = (name: string) => itemTitle(name, items?.find((i) => i.name === name)?.archive);
  const scan = (name: string, n: number, width: number) => `/api/collections/${collectionId}/items/${name}/scans/${n}?width=${width}`;

  const own = types.filter((t) => !t.unknown);
  const open = looked?.types.filter((s) => !(s.label in looked.answered)) ?? [];
  const unwritten = own.filter((t) => !t.templateVersion);
  const level = collection.levels[0];
  const changed = () => { setChanges((n) => n + 1); onChanged(); };

  async function look() {
    setAsking(false);
    setBusy("look");
    setError("");
    try {
      const found = await backendRequest<{ types: Suggestion[] }>(`/collections/${collectionId}/page-types/suggest`,
        json("POST", { item, count: LOOK, pick: "spread", ...asker }));
      const said = { item, types: found.types, answered: {} };
      try { localStorage.setItem(kept, JSON.stringify(said)); } catch { /* kept for this visit only */ } // even if this screen was left meanwhile
      setLooked(said);
    } catch (e) {
      setError(message(e, "Could not look at its pages."));
    }
    setBusy("");
  }
  // One answer for a group of pages: they're a new kind (added under the name given), one of the kinds so far, or neither (left
  // unsaid: covers, blank backs). The sample's pages are labelled with the kind.
  async function answer(s: Suggestion, said: Answer) {
    if (!looked) return;
    setBusy(s.label);
    setError("");
    try {
      const type = said.kind === "new"
        ? await backendRequest<PageType>("/page-types", json("POST", { label: said.label, reviewerId: me().id, collectionId }))
        : said.kind === "is" ? said.type : null;
      if (said.kind === "new") onChanged(); // the new kind is there, even if labelling its pages fails
      for (const page of type ? s.pages : []) {
        await backendRequest(`/collections/${collectionId}/items/${looked.item}/labels/${page}`, json("PUT", { pageType: type!.name }));
      }
      setLooked({ ...looked, answered: { ...looked.answered,
        [s.label]: said.kind === "skip" ? "skipped" : said.kind === "new" ? `a new kind, ${said.label}` : `${said.type.label}s` } });
      if (type) changed();
    } catch (e) {
      setError(message(e, "Could not save that."));
    }
    setBusy("");
  }

  const answered = looked?.types.filter((s) => s.label in looked.answered) ?? [];
  const askRecord = own.length > 0 && !level && !recordSaid && !isSetUp(collection);
  // Last, once its kinds of page each have a list: reading one item, to see it come out right (it's set up once one has been).
  const askRead = own.length > 0 && !unwritten.length && !setUpSteps(collection).sample;
  const asked = open.length + unwritten.length + (askRecord ? 1 : 0) + (askRead ? 1 : 0);
  return (
    <div className="max-w-4xl">
      <section aria-labelledby="questions" className="min-w-0 space-y-4">
        <div>
          <h2 id="questions" className="text-xl font-semibold tracking-tight">Set up this series</h2>
          <p className="text-sm text-muted-foreground">
            PrestCribe looks at some of its pages, then asks you about what it found.
            {isSetUp(collection) && <> <a className="underline" href={`/?series=${collectionId}&view=setup`} onClick={navigate}>Back to the overview</a></>}
          </p>
        </div>
        {items && !items.length ? (
          <p className="text-sm text-muted-foreground">
            Add items to the series on its <a className="underline" href={`/?series=${collectionId}`}>Items</a> page first. Once they're there, you can carry on here.
          </p>
        ) : configured === null && !sorter ? (
          <p className="text-sm text-muted-foreground">Choose a model in <a className="underline" href="/?view=settings">Settings</a> first: it looks at the pages.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Item to look at" className="w-full sm:w-72" value={item} disabled={Boolean(busy)}
              onChange={(e) => setItem(e.target.value)}>
              {(items ?? []).map((i) => <option key={i.name} value={i.name}>{itemTitle(i.name, i.archive)}</option>)}
            </NativeSelect>
            <Button variant={own.length ? "outline" : "ai"} disabled={!item || !asker || Boolean(busy)} onClick={() => setAsking(true)}>
              <ScanSearch /> {own.length ? "Look at more pages" : "Look at some pages"}
            </Button>
          </div>
        )}
        {busy === "look" && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Looking at {LOOK} pages of {title(item)}… about a minute.
          </p>
        )}
        {error && <Alert variant="destructive"><AlertDescription className="whitespace-pre-line">{error}</AlertDescription></Alert>}
        {busy !== "look" && !(items && !items.length) && (asked ? (
          <ol aria-label="Questions to answer" className="space-y-4">
            {looked && open.map((s) => (
              <Ask key={s.label} question={`These ${plural(s.pages.length, "page")} look alike. What are they?`}>
                <Group suggestion={s} kinds={own} busy={Boolean(busy)} scan={(n, w) => scan(looked.item, n, w)} onAnswer={(said) => answer(s, said)} />
              </Ask>
            ))}
            {unwritten.map((t) => {
              const sample = looked && Object.entries(labels).find(([, kind]) => kind === t.name)?.[0];
              return (
                <Ask key={t.name} question={`What should be written down from each ${t.label}?`}>
                  <div className={`grid gap-4 ${sample ? "md:grid-cols-[10rem_minmax(0,1fr)]" : ""}`}>
                    {sample && (
                      <a href={scan(looked!.item, Number(sample), 1200)} target="_blank" rel="noopener noreferrer">
                        <img src={scan(looked!.item, Number(sample), 240)} alt={`A ${t.label}`} className="w-40 rounded-sm border object-cover object-top" />
                      </a>
                    )}
                    <Fields key={`${t.name}-${t.templateVersion}`} collectionId={collectionId} type={t}
                      draft={drafts[`${t.name}-${t.templateVersion}`]}
                      onDraft={(rows) => setDrafts((d) => ({ ...d, [`${t.name}-${t.templateVersion}`]: rows }))} onSaved={changed} />
                  </div>
                </Ask>
              );
            })}
            {askRecord && (
              <Ask question="Where does one record start?">
                <Structure collectionId={collectionId} collection={collection} kinds={own} onSaved={(said) => { setRecordSaid(said); changed(); }} />
              </Ask>
            )}
            {askRead && (
              <Ask question="Read one item to check it works">
                {collection.running ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Reading it…</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button asChild><a href={`/?series=${collectionId}&item=${encodeURIComponent(item)}`}>Open {title(item)}</a></Button>
                    <span className="text-sm text-muted-foreground">Press Transcribe there, then look at how it came out.</span>
                  </div>
                )}
              </Ask>
            )}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {own.length ? "Nothing to ask right now. Look at more pages to check nothing's missing." : "Look at some pages to start."}
          </p>
        ))}
        {(answered.length > 0 || recordSaid) && (
          <section aria-label="Answered" className="space-y-1">
            {answered.map((s) => (
              <p key={s.label} className="flex items-center gap-2 text-sm">
                <CircleCheck aria-hidden="true" className="size-4 text-emerald-600" />
                <span>{plural(s.pages.length, "page")} that looked alike:</span>
                <span className="text-muted-foreground">{looked!.answered[s.label]}</span>
              </p>
            ))}
            {recordSaid && (
              <p className="flex items-center gap-2 text-sm">
                <CircleCheck aria-hidden="true" className="size-4 text-emerald-600" />
                <span>Where one record starts:</span>
                <span className="text-muted-foreground">{recordSaid}</span>
              </p>
            )}
          </section>
        )}
      </section>
      {asking && asker && (
        <Dialog open onOpenChange={setAsking}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Look at {LOOK} pages of {title(item)}</DialogTitle>
              <DialogDescription>
                PrestCribe shows the pages to a model side by side, and it says which look alike and what kind of page each is. Nothing is
                saved until you answer.
              </DialogDescription>
            </DialogHeader>
            <dl className="divide-y rounded-md border text-sm">
              <div className="flex gap-4 p-3"><dt className="w-20 text-muted-foreground">Model</dt>
                <dd>{named(asker)} · {providerNames[asker.provider] ?? asker.provider}</dd></div>
              <div className="flex gap-4 p-3"><dt className="w-20 text-muted-foreground">Effort</dt>
                <dd>{asker.effort}{!sorter && configured && configured.effort !== asker.effort ? ` (reading uses ${configured.effort}: telling pages apart needs less)` : ""}</dd></div>
              <div className="flex gap-4 p-3"><dt className="w-20 text-muted-foreground">Paid by</dt>
                <dd>{providerBlurbs[asker.provider] ?? asker.provider}: one request</dd></div>
              <div className="flex gap-4 p-3"><dt className="w-20 text-muted-foreground">Time</dt>
                <dd>About a minute. The first time, the item's PDF is downloaded from the archive.</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {sorter ? "The model this series sorts its pages with." : "The model that reads pages (Settings), as this series sorts its pages with it."} To use
              another, change it under Sorting.
            </p>
            {open.length > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-300">The {plural(open.length, "group")} not answered yet will be replaced.</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="ai" onClick={look}><ScanSearch /> Look at them</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// One thing PrestCribe asks: the question, and how it's answered.
function Ask({ question, children }: { question: string; children: ReactNode }) {
  return (
    <li className="space-y-3 rounded-lg border p-5">
      <h3 className="font-semibold">{question}</h3>
      {children}
    </li>
  );
}

// Pages the model saw as one kind: its name for them and why, the pages (each opening full size), and one answer for them all.
function Group({ suggestion, kinds, busy, scan, onAnswer }: {
  suggestion: Suggestion; kinds: PageType[]; busy: boolean; scan: (n: number, width: number) => string; onAnswer: (said: Answer) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState(suggestion.label);
  const [picked, setPicked] = useState(""); // one of the kinds so far, saved by its button (not as the list is gone through)
  const known = kinds.find((k) => k.label.toLowerCase() === suggestion.label.toLowerCase());
  const others = kinds.filter((k) => k !== known);
  const chosen = others.find((k) => k.name === picked);
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <p><span className="font-medium">{suggestion.label}</span>
          <span className="text-sm text-muted-foreground"> · {plural(suggestion.pages.length, "page")} look alike</span></p>
        {suggestion.description && <p className="text-sm text-muted-foreground">{suggestion.description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestion.pages.map((n) => (
          <a key={n} href={scan(n, 1200)} target="_blank" rel="noopener noreferrer" title={`Page ${n}`}>
            <img src={scan(n, 240)} alt={`Page ${n}`} loading="lazy" className="h-20 w-28 rounded-sm border bg-muted object-contain" />
          </a>
        ))}
      </div>
      {naming ? (
        <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); onAnswer({ kind: "new", label: label.trim() }); }}>
          <Input autoFocus aria-label="Name of the new kind" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" disabled={busy || !label.trim()}>Add kind</Button>
          <Button type="button" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {known ? <Button size="sm" disabled={busy} onClick={() => onAnswer({ kind: "is", type: known })}>They're {known.label}s</Button>
            : <Button size="sm" disabled={busy} onClick={() => setNaming(true)}>New kind: {suggestion.label}</Button>}
          {others.length > 0 && (
            <NativeSelect size="sm" aria-label="They're one of the kinds so far" value={picked} disabled={busy} onChange={(e) => setPicked(e.target.value)}>
              <option value="">They're…</option>
              {others.map((k) => <option key={k.name} value={k.name}>{k.label}s</option>)}
            </NativeSelect>
          )}
          {chosen && <Button size="sm" disabled={busy} onClick={() => onAnswer({ kind: "is", type: chosen })}>Save</Button>}
          {known && <Button size="sm" variant="outline" disabled={busy} onClick={() => setNaming(true)}>A new kind</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAnswer({ kind: "skip" })}>Skip: covers, blanks</Button>
        </div>
      )}
    </div>
  );
}

// What one record is: what the series calls one, and where one starts (each page its own, a run of pages from a starting kind,
// or the whole item, which is no level at all). One with pages matched by number, or several levels, is set under Structure.
function Structure({ collectionId, collection, kinds, onSaved }: {
  collectionId: number; collection: Collection; kinds: PageType[]; onSaved: (said: string) => void;
}) {
  const level = collection.levels[0];
  const [name, setName] = useState(level?.name ?? "");
  const [shape, setShape] = useState<"run" | "page" | "item">(level && !level.parts.length ? "page" : "run");
  const [startType, setStartType] = useState(level?.parts.find((p) => p.how === "starts")?.type ?? kinds[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const one = name.trim().toLowerCase() || "record";
  async function save() {
    setBusy(true);
    setError("");
    const levels = shape === "item" ? [] : [{ name: one, key: null,
      parts: shape === "run" ? partsOf({ kind: "run", start: startType }, kinds.map((k) => k.name)) : [] }];
    try {
      await backendRequest(`/collections/${collectionId}/levels`, json("PUT", { levels }));
      onSaved(shape === "item" ? `the whole item is one ${one}` : shape === "page" ? `each page is one ${one}`
        : `at each ${kinds.find((k) => k.name === startType)?.label ?? startType}, with the pages after it`);
    } catch (e) {
      setError(message(e, "Could not save it."));
    }
    setBusy(false);
  }
  const choice = (value: typeof shape, text: ReactNode) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name={`shape-${collectionId}`} className="size-4 accent-primary" checked={shape === value} onChange={() => setShape(value)} />
      {text}
    </label>
  );
  return (
    <div className="space-y-3">
      <label className="flex max-w-sm flex-col gap-1 text-sm">
        What it calls one
        <Input placeholder="e.g. survey" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm">Where one starts</legend>
        {choice("run", <>At each <NativeSelect size="sm" aria-label="Kind of page it starts at" value={startType} onChange={(e) => { setStartType(e.target.value); setShape("run"); }}>
          {kinds.map((k) => <option key={k.name} value={k.name}>{k.label}</option>)}
        </NativeSelect>, with the pages after it</>)}
        {choice("page", `Each page is one ${one}`)}
        {choice("item", `The whole item is one ${one}`)}
      </fieldset>
      {error && <Alert variant="destructive"><AlertDescription className="whitespace-pre-line">{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || (shape !== "item" && !name.trim())} onClick={save}>Save</Button>
        <a className="text-sm text-muted-foreground underline-offset-4 hover:underline" href={`/?series=${collectionId}&view=setup&section=levels`}>
          Pages filed elsewhere, or records inside records? Set them under Structure
        </a>
      </div>
    </div>
  );
}
