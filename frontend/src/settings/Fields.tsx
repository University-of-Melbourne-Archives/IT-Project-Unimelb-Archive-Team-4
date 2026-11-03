import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { me } from "../person";
import { backendRequest } from "../progress/backend";
import type { PageType } from "./PageTypesScreen";
import { cleanRules, parseTemplate, type Rules, type Template } from "./rules";

type Version = { id: number; body: string; rules: Rules };
export type Row = { name: string; key?: string }; // key: a saved field's, until its name is edited

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const start = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
// A field as typed, as a template's key ("Index No." -> index_no), and a key as it is shown (index_no -> Index no).
const keyOf = (name: string) => {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(key) ? `field_${key}` : key;
};
const nameOf = (key: string) => start(key.replaceAll("_", " "));
const ANNOTATIONS = "annotations"; // filled in by the reading model, not a field to write down

// A page type's fields to read, its template, as a list of names (as edited: draft, kept by what shows it): saved as a
// new version of it, each field kept with its description and rules, and its annotations list (what the reading model fills in
// beside the fields) kept as it is, unshown; one whose fields are grouped is edited under Kinds of page.
export function Fields({ collectionId, type, draft, onDraft, onSaved }: {
  collectionId: number; type: PageType; draft?: Row[]; onDraft: (rows: Row[]) => void; onSaved: () => void;
}) {
  const [newest, setNewest] = useState<Version | null | undefined>(type.templateVersion ? undefined : null); // undefined: loading
  const [saved, setSaved] = useState<Row[]>([{ name: "" }]);
  const rows = draft ?? saved;
  const setRows = onDraft;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!type.templateVersion) return;
    let current = true;
    backendRequest<Version[]>(`/instructions/${type.name}`)
      .then(([found]) => {
        if (!current) return;
        setNewest(found);
        setSaved(Object.keys(parseTemplate(found.body) ?? {}).filter((key) => key !== ANNOTATIONS).map((key) => ({ name: nameOf(key), key })));
      })
      .catch((e) => { if (current) setError(message(e, "Could not load its fields.")); });
    return () => { current = false; };
  }, [type]);

  const full = `/?series=${collectionId}&view=setup&section=page-types`;
  if (newest === undefined) return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
    : <p className="text-sm text-muted-foreground">Loading its fields…</p>;
  const old: Template = parseTemplate(newest?.body ?? null) ?? {};
  const fields = Object.keys(old).filter((key) => key !== ANNOTATIONS);
  if (fields.some((key) => old[key] !== null && typeof old[key] !== "string")) {
    return (
      <p className="text-sm text-muted-foreground">
        {type.label}'s fields are in groups: edit them under <a className="text-primary underline-offset-4 hover:underline" href={full}>Kinds of page</a>.
      </p>
    );
  }
  const keys = rows.map((r) => r.key ?? keyOf(r.name)).filter(Boolean);
  const twice = new Set(keys).size < keys.length || (ANNOTATIONS in old && keys.includes(ANNOTATIONS));
  const changed = keys.join() !== fields.join();
  const save = async () => {
    setBusy(true);
    setError("");
    const template = Object.fromEntries([...keys.map((k) => [k, k in old ? old[k] : null]),
      ...(ANNOTATIONS in old ? [[ANNOTATIONS, old[ANNOTATIONS]]] : [])]);
    try {
      await backendRequest(`/instructions/${type.name}`, json("POST", {
        body: JSON.stringify(template, null, 2), rules: cleanRules(newest?.rules ?? {}, template), basedOn: newest?.id ?? null,
        reviewerId: me().id }));
      onSaved();
    } catch (e) {
      setError(message(e, "Could not save its fields."));
    }
    setBusy(false);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">Fields to read from each {type.label}</legend>
      {!type.templateVersion && <p className="text-xs text-muted-foreground">Its pages aren't read until these are saved.</p>}
      <ol className="space-y-1.5">
        {rows.map((row, i) => (
          <li key={i} className="flex gap-2">
            <Input aria-label={`Field ${i + 1}`} placeholder="Surname" value={row.name}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { name: e.target.value } : r)))} />
            <Button variant="ghost" size="icon" aria-label={`Remove field ${i + 1}`} disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}><X /></Button>
          </li>
        ))}
      </ol>
      {twice && <p className="text-sm text-destructive">Two fields have the same name.</p>}
      {error && <Alert variant="destructive"><AlertDescription className="whitespace-pre-line">{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { name: "" }])}><Plus /> Add field</Button>
        <Button size="sm" disabled={busy || !keys.length || twice || !changed} onClick={save}>Save template</Button>
      </div>
      <a className="block text-xs text-muted-foreground underline-offset-4 hover:underline" href={full}>Edit as JSON, or set rules for its fields</a>
    </fieldset>
  );
}
