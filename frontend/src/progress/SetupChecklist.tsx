import { useEffect, useState } from "react";
import { Circle, CircleCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { navigate } from "../navigate";
import { backendRequest, itemTitle } from "./backend";
import { isSetUp, setUpSteps, type SeriesCounts } from "./setup";

type PageType = { name: string; label: string; unknown: boolean; templateVersion: number | null };
type Step = { title: string; done: boolean; optional?: boolean; detail?: string; action?: { label: string; href: string } };

const list = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0] ?? "");

// Setting a series up, at the top of its Items page. Until it's set up, one line: the setup wizard, until its kinds of page and
// what to write down from each are set, then reading a sample item. Once set up, its steps ticked, pointing to the item read as a
// sample, until another is read. It loads again when the page is shown again, and every few seconds while an item is being read.
export default function SetupChecklist({ collectionId }: { collectionId: number }) {
  const [found, setFound] = useState<{ series: SeriesCounts; types: PageType[]; read: { id: string; name: string }[] } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    Promise.all([
      backendRequest<SeriesCounts>(`/collections/${collectionId}`),
      backendRequest<PageType[]>(`/page-types?collection=${collectionId}`),
      backendRequest<{ id: string; name: string }[]>(`/export/bundles?collection=${collectionId}`),
    ]).then(([series, types, read]) => { if (current) setFound({ series, types, read }); }).catch(() => {});
    return () => { current = false; };
  }, [collectionId, attempt]);
  useEffect(() => {
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("focus", again);
    window.addEventListener("pageshow", again);
    return () => { window.removeEventListener("focus", again); window.removeEventListener("pageshow", again); };
  }, []);
  const running = found?.series.running ?? 0;
  const hidden = !found || (isSetUp(found.series) && found.series.bundles > 1);
  useEffect(() => {
    if (!running || hidden) return;
    const timer = window.setInterval(() => setAttempt((n) => n + 1), 5000);
    return () => window.clearInterval(timer);
  }, [running, hidden]);
  if (hidden) return null;

  const done = setUpSteps(found.series);
  const setup = `/?series=${collectionId}&view=setup`;
  if (!done.types || !done.templates || !done.sample) {
    const wizard = !done.types || !done.templates;
    return (
      <section aria-labelledby="setup-checklist"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
        <h2 id="setup-checklist" className="font-semibold">
          {wizard ? "This series isn't set up yet" : running ? "Reading a sample item…" : "Almost set up: press Transcribe on one of its items below"}
        </h2>
        {wizard && <Button asChild><a href={setup} onClick={navigate}>Run the setup wizard</a></Button>}
      </section>
    );
  }
  const sample = found.read[0];
  const steps: Step[] = [
    { title: "Add its page types", done: true, detail: list(found.types.filter((t) => !t.unknown).map((t) => t.label)) },
    { title: "Give each page type a template", done: true },
    { title: "Read one item as a sample", done: true, detail: sample ? itemTitle(sample.name) : undefined,
      action: sample ? { label: "Check it", href: `/?series=${collectionId}&item=${encodeURIComponent(sample.name)}` } : undefined },
    { title: "Say what a record is", done: done.record, optional: true, detail: done.record ? undefined : "Without it, each item is one record.",
      action: done.record ? undefined : { label: "Set levels", href: `${setup}&section=levels` } },
  ];
  return (
    <section aria-labelledby="setup-checklist"
      className="space-y-4 rounded-lg border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/30">
      <div className="flex gap-3">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-emerald-600" />
        <div>
          <h2 id="setup-checklist" className="text-lg font-semibold tracking-tight">Series set up</h2>
          <p className="text-sm text-muted-foreground">Check the sample came out right, then read the other items.</p>
        </div>
      </div>
      <ol aria-label="Setup steps" className="divide-y overflow-hidden rounded-md border bg-background">
        {steps.map((s) => (
          <li key={s.title} className="flex flex-wrap items-center gap-3 border-l-4 border-l-transparent px-3 py-2.5 text-sm">
            {s.done ? <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-emerald-600" />
              : <Circle aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.title}<span className="sr-only">{s.done ? ": done" : ": to do"}</span>
                {s.optional && <Badge variant="secondary" className="ml-2">Optional</Badge>}
              </p>
              {s.detail && <p className="text-muted-foreground">{s.detail}</p>}
            </div>
            {s.action && <Button variant="outline" size="sm" asChild><a href={s.action.href}>{s.action.label}</a></Button>}
          </li>
        ))}
      </ol>
    </section>
  );
}
