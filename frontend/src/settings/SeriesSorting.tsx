import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { backendRequest, modelsOf, providerNames, readyOf, type ApiKey, type ProviderOptions } from "../progress/backend";
import Segmented from "./Segmented";

type Sorter = { provider: string; model: string; effort: string };

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const keyOf = (provider: string, model: string) => `${provider}\u0000${model}`;
const name = (provider: string) => providerNames[provider] ?? provider;

// Which model sorts a series' pages into its page types: the transcription model, or another connected one for this series
// only. Saved as soon as it's chosen.
export default function SeriesSorting({ collectionId }: { collectionId: number }) {
  const [sorter, setSorter] = useState<Sorter | null | undefined>(undefined); // undefined until loaded
  const [other, setOther] = useState(false); // "Another model" picked, before a model is chosen
  const [options, setOptions] = useState<Record<string, ProviderOptions> | null | undefined>(undefined);
  const [ready, setReady] = useState<Record<string, boolean | undefined>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false); // one save at a time, so the server and the screen agree

  useEffect(() => {
    backendRequest<{ sorter: Sorter | null }>(`/collections/${collectionId}/page-sorting`).then((r) => setSorter(r.sorter))
      .catch((e) => setError(message(e, "Could not load how this series' pages are sorted.")));
    Promise.all([
      backendRequest<Record<string, { signedIn: boolean }>>("/connections").catch(() => null),
      backendRequest<ApiKey[]>("/api-keys").catch(() => null),
      backendRequest<Record<string, ProviderOptions>>("/transcription-options").catch(() => null),
    ]).then(([connections, keys, found]) => {
      setOptions(found);
      setReady(readyOf(connections, keys, found));
    });
  }, [collectionId]);

  async function save(next: Sorter | null) {
    const before = sorter;
    setError("");
    setSaving(true);
    setSorter(next); // shown at once; put back if not saved
    try {
      setSorter((await backendRequest<{ sorter: Sorter | null }>(`/collections/${collectionId}/page-sorting`, json("PUT", { sorter: next }))).sorter);
    } catch (e) {
      setSorter(before);
      setError(message(e, "Could not save it."));
    } finally {
      setSaving(false);
    }
  }

  function choose(value: string) {
    const [provider, model] = value.split("\u0000");
    const option = options?.[provider]?.models.find((m) => m.value === model);
    const efforts = option?.efforts?.length ? option.efforts : options?.[provider]?.efforts ?? [];
    // sorting is an easy question: the lowest effort offered, or the API's default
    void save({ provider, model, effort: efforts.includes("low") ? "low" : option?.defaultEffort ?? efforts[0] ?? "default" });
  }

  if (sorter === undefined) return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null;
  const providers = Object.entries(options ?? {}).filter(([p, o]) => ready[p] && modelsOf(o));
  const offered = sorter && providers.some(([p, o]) => p === sorter.provider && o.models.some((m) => m.value === sorter.model));
  const listing = other || Boolean(sorter);

  return (
    <section aria-labelledby={`sorting-${collectionId}`} className="max-w-2xl space-y-3 pt-6">
      <h3 id={`sorting-${collectionId}`} className="font-medium">Sorting pages into types</h3>
      <Segmented label="Which model sorts this series' pages" value={listing ? "other" : "same"}
        onChange={(v) => { if (saving) return; setOther(v === "other"); if (v === "same" && sorter) void save(null); }}
        options={[{ value: "same", label: "Same as transcription" }, { value: "other", label: "Another model" }]} />
      {listing && (
        <NativeSelect aria-label="Model that sorts this series' pages" className="w-full" value={sorter ? keyOf(sorter.provider, sorter.model) : ""}
          disabled={saving} onChange={(e) => choose(e.target.value)}>
          {!sorter && <NativeSelectOption value="" disabled>Choose a model…</NativeSelectOption>}
          {sorter && !offered && <NativeSelectOption value={keyOf(sorter.provider, sorter.model)}>{sorter.model} ({name(sorter.provider)})</NativeSelectOption>}
          {providers.map(([provider, o]) => (
            <NativeSelectOptGroup key={provider} label={name(provider)}>
              {o.models.map((m) => <NativeSelectOption key={m.value} value={keyOf(provider, m.value)}>{m.label}</NativeSelectOption>)}
            </NativeSelectOptGroup>
          ))}
        </NativeSelect>
      )}
      {sorter && ready[sorter.provider] === false && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{name(sorter.provider)} isn't connected on this computer. Choose another model.</p>
      )}
      {other && !sorter && options !== undefined && providers.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">Connect a provider in Settings first. Its models then appear here.</p>
      )}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </section>
  );
}
