import { useEffect, useId, useState } from "react";
import { File, Layers, Wand2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { navigate } from "../navigate";
import { backendRequest, itemTitle, recordNumber, recordWords, type ArchiveItem } from "../progress/backend";
import type { Collection, PageType } from "./PageTypesScreen";
import { describe } from "./shapes";

type Page = { id: string; label: string; category: string; surveyId: string | null };
type Detail = { bundle: string; pages: Page[]; records: { id: string; parent: string | null }[] };

// Each kind of page's colour, by its place in the series' kinds; the series' Unknown kind is grey.
const COLOURS = [
  "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200", "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200", "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200", "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
];
const UNKNOWN = "bg-muted text-muted-foreground";
const SHOWN = 8; // records shown at first, and more each time
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const start = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

// A set-up series' setup as it comes out: one item it has read, its pages in order, each with its kind, in the records they were
// grouped into; the kinds and what one record is, in words; and, if that doesn't look right, where to change it.
export default function SetupOverview({ collectionId, collection, types }: { collectionId: number; collection: Collection; types: PageType[] }) {
  const id = useId();
  const [read, setRead] = useState<{ id: string; name: string }[] | null>(null);
  const [titles, setTitles] = useState<Record<string, ArchiveItem | null>>({});
  const [item, setItem] = useState("");
  const [detail, setDetail] = useState<{ of: string; found: Detail } | null>(null);
  const [shown, setShown] = useState(SHOWN);
  const [error, setError] = useState<{ of: string; message: string } | null>(null); // a load that failed, for the item it was for ("": the list)
  useEffect(() => {
    backendRequest<{ id: string; name: string }[]>(`/export/bundles?collection=${collectionId}`)
      .then((found) => {
        const sorted = [...found].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); // the archive's order
        setRead(sorted);
        setItem((chosen) => chosen || sorted[0]?.name || "");
      })
      .catch((e) => setError({ of: "", message: message(e, "Could not load the series' items.") }));
    // the titles of its first hundred items (the most the server sends at once); any other shows as its number
    backendRequest<{ items: { name: string; archive: ArchiveItem | null }[] }>(`/collections/${collectionId}/items?page=0&size=100`)
      .then((listed) => setTitles(Object.fromEntries(listed.items.map((i) => [i.name, i.archive])))).catch(() => {});
  }, [collectionId]);
  useEffect(() => {
    if (!item) return;
    let current = true;
    backendRequest<Detail>(`/collections/${collectionId}/items/${item}`)
      .then((found) => { if (current) setDetail({ of: item, found }); })
      .catch((e) => { if (current) setError({ of: item, message: message(e, "Could not load the item.") }); });
    return () => { current = false; };
  }, [collectionId, item]);

  const own = types.filter((t) => !t.unknown);
  const colour = (label: string) => { const at = own.findIndex((t) => t.label === label); return at < 0 ? UNKNOWN : COLOURS[at % COLOURS.length]; };
  const level = collection.levels[0];
  const words = recordWords(level?.name ?? collection.recordName ?? "record");
  const found = detail?.of === item ? detail.found : null;
  const failed = error?.of === item ? error.message : "";
  // The pages in order, in runs by the record each is in (none: not in one).
  const runs: { record: string | null; pages: Page[] }[] = [];
  for (const page of found?.pages ?? []) {
    const last = runs.at(-1);
    if (last && last.record === page.surveyId) last.pages.push(page);
    else runs.push({ record: page.surveyId, pages: [page] });
  }
  const counts = own.concat(types.filter((t) => t.unknown)).map((t) => [t, found?.pages.filter((p) => p.category === t.label).length ?? 0] as const);

  return (
    <section aria-labelledby="overview" className="space-y-5">
      <div className="space-y-3">
        <div>
          <h2 id="overview" className="text-xl font-semibold tracking-tight">
            {item ? `Check how ${itemTitle(item, titles[item])} was read` : "How its pages are read"}
          </h2>
          <p className="text-sm text-muted-foreground">Does each page have the right kind, and each {words.one} the right pages? Pages are in scan order.</p>
        </div>
        {read && read.length > 1 && (
          <div className="flex items-center gap-3">
            <FieldLabel htmlFor={`${id}-item`}>Item</FieldLabel>
            <NativeSelect id={`${id}-item`} className="w-full sm:w-72" value={item} onChange={(e) => { setItem(e.target.value); setShown(SHOWN); }}>
              {read.map((r) => <option key={r.id} value={r.name}>{itemTitle(r.name, titles[r.name])}</option>)}
            </NativeSelect>
          </div>
        )}
      </div>
      {failed && <Alert variant="destructive"><AlertDescription>{failed}</AlertDescription></Alert>}
      {read && !read.length ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No items read yet. Read one on the <a className="underline" href={`/?series=${collectionId}`}>Items</a> page to see how it comes out.
        </p>
      ) : !found ? (
        !failed && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading its pages…</p>
      ) : (
        <>
          <ol aria-label={`${start(words.many)} of ${itemTitle(item, titles[item])}`} className="flex flex-wrap gap-3">
            {runs.slice(0, shown).map((run, i) => (
              <li key={`${run.record}-${i}`} className={`max-w-full space-y-2 rounded-lg border p-2 ${run.record ? "" : "border-dashed"}`}>
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  {run.record ? `${words.One} ${recordNumber(run.record, found.bundle)}` : `Not in ${words.a}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {run.pages.map((p) => (
                    <a key={p.id} href={`/api/pages/${encodeURIComponent(p.id)}/image`} target="_blank" rel="noopener noreferrer"
                      title={`${p.label}: ${p.category}`} className="w-28 space-y-1 text-center">
                      <Thumbnail id={p.id} />
                      <span className={`block truncate rounded px-1 text-xs ${colour(p.category)}`}>{p.category}</span>
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {runs.length > shown && (
            <Button variant="outline" size="sm" onClick={() => setShown(shown + SHOWN)}>Show more ({runs.length - shown} left)</Button>
          )}
          <dl className="grid gap-2 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Kinds of page</dt>
            <dd className="flex flex-wrap gap-2">
              {counts.map(([t, n]) => (
                <span key={t.name} className={`rounded px-2 py-0.5 ${t.unknown ? UNKNOWN : colour(t.label)}`}>{t.label} · {n}</span>
              ))}
            </dd>
            <dt className="text-muted-foreground">One {words.one}</dt>
            <dd>{level ? describe(level, (n) => types.find((t) => t.name === n)?.label ?? n) : "The whole item"}</dd>
          </dl>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <span className="text-sm text-muted-foreground">Doesn't look right?</span>
        <Button variant="outline" size="sm" asChild>
          <a href={`/?series=${collectionId}&view=setup&section=levels`} onClick={navigate}><Layers /> Change how {words.many} are grouped</a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`/?series=${collectionId}&view=setup&section=page-types`} onClick={navigate}><File /> Change the kinds of page</a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`/?series=${collectionId}&view=setup&section=wizard`} onClick={navigate}><Wand2 /> Open the setup wizard</a>
        </Button>
      </div>
    </section>
  );
}


// A read page, small and whole (scans may be wide or tall): its thumbnail, else (none made here) its full image.
function Thumbnail({ id }: { id: string }) {
  const image = `/api/pages/${encodeURIComponent(id)}/image`;
  return (
    <img src={`/api/pages/${encodeURIComponent(id)}/thumbnail`} alt="" loading="lazy" className="h-20 w-28 rounded-sm border bg-muted object-contain"
      onError={(e) => { if (!e.currentTarget.dataset.full) { e.currentTarget.dataset.full = "1"; e.currentTarget.src = image; } }} />
  );
}
