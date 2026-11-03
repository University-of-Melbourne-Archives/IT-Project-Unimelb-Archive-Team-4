import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Box, File, Layers, Plus, WandSparkles } from "lucide-react";

import { cn } from "cn";

import AppHeader from "@/components/AppHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { navigate } from "../navigate";
import { me } from "../person";
import { backendRequest, seriesParam } from "../progress/backend";
import { isSetUp, type SeriesCounts } from "../progress/setup";
import ChecksSection from "./ChecksSection";
import FieldRules from "./FieldRules";
import { cleanRules, parseTemplate, sameRules, type Rules } from "./rules";
import SeriesSorting from "./SeriesSorting";
import SetupOverview from "./SetupOverview";
import SetupQuestions from "./SetupQuestions";
import SuggestTypesDialog from "./SuggestTypesDialog";
import { describe } from "./shapes";

export type PageType = { name: string; label: string; builtIn: boolean; unknown: boolean; templateVersion: number | null };
// One part of what a level's record is made of: a page type, how many of it one has, and how its pages are found (one starts
// it, the next follow the page before them, or are matched by number wherever they were filed).
export type Part = { type: string; count: "one" | "one_or_more" | "any" | "at_most_one"; how: "starts" | "follows" | "matched" };
// A level of record between an item and its pages: what one is called, what one is made of in order, and the field holding its
// number (null: page order only).
export type Level = { name: string; parts: Part[]; key: string | null };
export type Collection = {
  id: number; name: string; levels: Level[]; recordName: string; grouped: boolean; archiveIdentifier?: string | null;
  archiveSeries?: number | null;
};
type Version = { id: number; number: number; body: string; rules: Rules; reviewer: string | null; note: string | null; createdAt: string };

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const start = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
// The parts of a series' setup, as its side menu names them, by their ?section= in the URL; the setup wizard (wizard) has none.
const SECTIONS = [["overview", "Overview"], ["levels", "Structure"], ["page-types", "Kinds of page"], ["checks", "Checks"],
  ["sorting", "Sorting"]] as const;

// A series' setup, its own screen apart from the day-to-day Items and Accuracy, its parts one at a time from a side menu: an
// overview (how an item it has read came out; until it's set up, the setup wizard instead), its structure (its levels of record),
// its kinds of page (what each is called, the template its pages are read with and its fields' rules), its checks across fields
// and the model that sorts its pages. The one shown is in the URL (?view=setup&section=, the overview without one; wizard: the
// setup wizard again; the old ?view=page-types opens the kinds of page).
export default function PageTypesScreen() {
  const params = new URLSearchParams(location.search);
  const collectionId = Number(seriesParam(params)) || 1;
  const section = params.get("section") === "wizard" ? "wizard"
    : SECTIONS.find(([key]) => key === params.get("section"))?.[0] ?? (params.get("view") === "page-types" ? "page-types" : "overview");
  const home = (key: string) => key === section || (key === "overview" && section === "wizard");
  const [types, setTypes] = useState<PageType[] | null>(null);
  const [collection, setCollection] = useState<(Collection & SeriesCounts) | null>(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [editing, setEditing] = useState<PageType | null>(null);

  const load = useCallback(() =>
    Promise.all([
      backendRequest<PageType[]>(`/page-types?collection=${collectionId}`),
      backendRequest<Collection & SeriesCounts>(`/collections/${collectionId}`),
    ]).then(([t, c]) => {
      setTypes(t);
      setCollection(c);
      setLoadError("");
    }).catch((e) => setLoadError(message(e, "Could not load the page types."))), [collectionId]);
  useEffect(() => {
    void load();
    // Shown again by Back, it loads again: a level saved meanwhile shows.
    const restored = (e: PageTransitionEvent) => { if (e.persisted) void load(); };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, [load]);
  // Asked again every few seconds while one of its items is being read: the setup wizard moves on once it has been.
  useEffect(() => {
    if (!collection?.running) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [collection?.running, load]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader series={{ id: collectionId, name: collection?.name ?? "" }} crumbs={[{ label: "Setup" }]} />
      <main className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
          <p className="text-sm text-muted-foreground">How this series' pages are read and checked.</p>
        </div>
        {loadError && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {loadError} <Button variant="outline" size="sm" onClick={load}>Try again</Button>
            </AlertDescription>
          </Alert>
        )}
          <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <nav aria-label="Setup" className="flex flex-wrap gap-1 lg:flex-col">
              {SECTIONS.map(([key, label]) => (
                <a key={key} href={`/?series=${collectionId}&view=setup&section=${key}`} onClick={navigate}
                  aria-current={home(key) ? "page" : undefined}
                  className={cn("rounded-md px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    home(key) ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
                  {key === "overview" && collection && !isSetUp(collection) ? "Set up" : label}
                </a>
              ))}
            </nav>
            <div className="min-w-0">
          {section === "wizard" || (section === "overview" && collection && !isSetUp(collection))
            ? collection && types && <SetupQuestions collectionId={collectionId} collection={collection} types={types} onChanged={load} />
          : section === "overview" ? collection && types && <SetupOverview collectionId={collectionId} collection={collection} types={types} />
          : section === "levels" ? collection && types && <Levels collection={collection} types={types} />
          : section === "checks" ? types && <ChecksSection collectionId={collectionId} types={types} />
          : section === "sorting" ? <SeriesSorting collectionId={collectionId} /> : (
            types && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">Kinds of page</h2>
                    <p className="text-sm text-muted-foreground">A page is read with its type's template; a type with no template isn't read.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ai" onClick={() => setSuggesting(true)}><WandSparkles /> Suggest page types</Button>
                    <Button onClick={() => setAdding(true)}>Add page type</Button>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Page type</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead className="w-0"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {types.map((t) => (
                      <TableRow key={t.name}>
                        <TableCell className="font-medium">{t.label}</TableCell>
                        <TableCell>{t.unknown ? "Not read: pages sorting couldn't place wait here" : t.templateVersion ? "Saved" : "None yet"}</TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" aria-label={`Edit ${t.label}`} onClick={() => setEditing(t)}>Edit</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )
          )}
            </div>
          </div>
      </main>
      {suggesting && types && (
        <SuggestTypesDialog collectionId={collectionId} existing={types.filter((t) => !t.unknown).map((t) => t.label)}
          onClose={() => setSuggesting(false)} onChanged={load} onAdded={() => { setSuggesting(false); load(); }} />
      )}
      {adding && (
        <AddDialog collectionId={collectionId} onClose={() => setAdding(false)}
          onAdded={(created) => { setAdding(false); setEditing(created); load(); }} />
      )}
      {editing && (
        <EditDialog type={editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

// One rung of the levels' ladder, indented under the one above.
function Rung({ depth, icon, name, how, fixed, children }: {
  depth: number; icon: ReactNode; name: string; how: string; fixed?: boolean; children?: ReactNode;
}) {
  return (
    <li className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${fixed ? "bg-muted/50 text-muted-foreground" : ""}`}
      style={{ marginLeft: `${depth * 1.5}rem` }}>
      <span aria-hidden="true" className="[&_svg]:size-4">{icon}</span>
      <span className={`min-w-20 font-medium ${fixed ? "" : "text-foreground"}`}>{name}</span>
      <span className="flex-1 text-muted-foreground">{how}</span>
      {children}
    </li>
  );
}

// The series' levels of record between an item and its pages, top first, as a ladder from Item to Page, each opening its own
// page; with none, each item is one record. A level added goes inside the bottom one.
function Levels({ collection, types }: { collection: Collection; types: PageType[] }) {
  const levels = collection.levels;
  const levelLink = (place: number | "new") => `/?series=${collection.id}&view=setup&level=${place}`;
  const label = (name: string) => types.find((t) => t.name === name)?.label ?? name;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Structure</h2>
        <p className="text-sm text-muted-foreground">
          How an item's pages group into records for review, each level inside the one above. Changes apply to items read from now on.
        </p>
      </div>
      <ol aria-label="Levels" className="max-w-2xl space-y-1.5">
        <Rung depth={0} icon={<Box />} name="Item" how="From the archive" fixed />
        {levels.map((level, i) => (
          <Rung key={level.name} depth={i + 1} icon={<Layers />} name={start(level.name)} how={describe(level, label)}>
            <Button variant="outline" size="sm" asChild><a href={levelLink(i + 1)} aria-label={`Edit ${level.name}`}>Edit</a></Button>
          </Rung>
        ))}
        <Rung depth={levels.length + 1} icon={<File />} name="Page" how="From the scan" fixed />
      </ol>
      {!levels.length && <p className="text-sm text-muted-foreground">No levels: each item is one record.</p>}
      <Button variant="outline" asChild><a href={levelLink("new")}><Plus /> Add level</a></Button>
    </section>
  );
}

function AddDialog({ collectionId, onClose, onAdded }: {
  collectionId: number; onClose: () => void;
  onAdded: (created: PageType) => void;
}) {
  const id = useId();
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError("");
    try {
      onAdded(await backendRequest<PageType>("/page-types", json("POST", { label, reviewerId: me().id, collectionId })));
    } catch (e) {
      setError(message(e, "Could not add the page type."));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add page type</DialogTitle>
          <DialogDescription>Then give it a template, so its pages can be read.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor={id}>Label</FieldLabel>
            <Input id={id} value={label} placeholder="e.g. Follow-up visit" onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </FieldGroup>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !label.trim()} onClick={add}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A page type's label, its template and its fields' rules (each save of those is a new version; an older one can be brought
// back).
function EditDialog({ type, onClose, onSaved }: {
  type: PageType; onClose: () => void; onSaved: () => void;
}) {
  const id = useId();
  const [label, setLabel] = useState(type.label);
  const [versions, setVersions] = useState<Version[]>([]); // newest first
  const [template, setTemplate] = useState<string | null>(type.templateVersion ? null : ""); // null: loading
  const [rules, setRules] = useState<Rules>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const newest = versions[0] ?? null;

  useEffect(() => {
    if (!type.templateVersion) return;
    backendRequest<Version[]>(`/instructions/${type.name}`)
      .then((loaded) => { setVersions(loaded); setTemplate(loaded[0].body); setRules(loaded[0].rules); })
      .catch((e) => setError(message(e, "Could not load the template.")));
  }, [type]);

  const parsed = parseTemplate(template);
  const cleaned = cleanRules(rules, parsed);
  const rulesChanged = !sameRules(cleaned, cleanRules(newest?.rules ?? {}, parseTemplate(newest?.body ?? null)));
  const templateChanged = template !== null && (template !== (newest?.body ?? "") || rulesChanged);
  const settingsChanged = label.trim() !== type.label;

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (settingsChanged) await backendRequest(`/page-types/${type.name}`, json("PATCH", { label }));
      if (templateChanged) {
        await backendRequest(`/instructions/${type.name}`,
          json("POST", { body: template, rules: cleaned, basedOn: newest?.id ?? null, reviewerId: me().id }));
      }
      onSaved();
    } catch (e) {
      setError(message(e, "Could not save."));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Edit {type.label}</DialogTitle>
          <DialogDescription>Changes apply to pages read from now on.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor={id}>Label</FieldLabel>
            <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          {type.unknown ? (
            <p className="text-sm text-muted-foreground">
              Pages sorting couldn't place wait here, unread, until a reviewer picks their type. They have no template.
            </p>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-template`}>Template</FieldLabel>
                <Textarea id={`${id}-template`} rows={12} className="font-mono text-xs" value={template ?? ""} disabled={template === null}
                  placeholder={'{"field_name": null}'} onChange={(e) => setTemplate(e.target.value)} />
                <FieldDescription>
                  The fields to read off each page, as JSON: every field is null (or its description), or an object of fields.
                  {!type.templateVersion && " Until it has one, pages of this type aren't read."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldTitle>Fields</FieldTitle>
                <FieldDescription>
                  What each field should hold. A transcription that breaks a field's rule is flagged for review; the description
                  helps the model read it.
                </FieldDescription>
                {parsed ? <FieldRules template={parsed} rules={rules} onRules={setRules} onTemplate={setTemplate} />
                  : <p className="text-sm text-muted-foreground">{template ? "Fix the template's JSON to set its fields' rules." : "Add fields to the template first."}</p>}
              </Field>
              {versions.length > 1 && (
                <Field>
                  <FieldTitle>History</FieldTitle>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Saved</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="w-0"><span className="sr-only">Use</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.map((v, n) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-medium">{v.number}</TableCell>
                          <TableCell className="text-muted-foreground">{v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}</TableCell>
                          <TableCell>{v.reviewer ?? "From the files"}</TableCell>
                          <TableCell className="whitespace-normal">{v.note}</TableCell>
                          <TableCell>
                            {n === 0 ? <span className="text-muted-foreground">Current</span> : (
                              <Button variant="outline" size="sm" aria-label={`Use version ${v.number}`}
                                onClick={() => { setTemplate(v.body); setRules(v.rules); }}>Use this version</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <FieldDescription>Using an older version fills it in above; saving makes it the newest.</FieldDescription>
                </Field>
              )}
            </>
          )}
        </FieldGroup>
        {error && <Alert variant="destructive"><AlertDescription className="whitespace-pre-line">{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !label.trim() || (!settingsChanged && !templateChanged)} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
