import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { backendRequest, modelsOf, providerBlurbs, providerNames, SIGN_IN, type ProviderOptions } from "../progress/backend";
import type { ModelChoice, ModelData } from "../progress/ModelControls";
import Segmented from "./Segmented";
import ProviderLogo from "./ProviderLogo";

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// The providers by how they're paid for; the form lists one group's at a time.
const WAYS = [
  { label: "Subscription", ids: ["claude", "codex"] },
  { label: "API key", ids: ["gemini", "anthropic", "openai", "openrouter"] },
  { label: "Local", ids: ["ollama"] },
];
const wayOf = (provider: string) => WAYS.find((w) => w.ids.includes(provider)) ?? WAYS[0];
const title = (provider: string) => (provider === "ollama" ? "Ollama" : providerNames[provider] ?? provider);
const same = (a: ModelChoice, b: ModelChoice | null | undefined) => Boolean(b && a.provider === b.provider && a.model === b.model && a.effort === b.effort);

// The model used when a transcription is started without choosing one, saved in the database. Once there is one it's shown as a
// summary with Change, which opens the form in place: how it's paid for, the provider, what connecting it still needs, then the
// model (and for a subscription, the effort, always chosen by hand). A choice is saved as soon as it's complete.
// options: each provider's models; ready: provider id -> connected (undefined: not known yet); connect: what connecting a provider
// needs (a key box or Sign in); manage: a connected provider's own links (Remove key, Sign out). When a connected provider's models
// can't be listed, the model (and effort) are typed instead.
export default function TranscriptionDefaults({ options, ready, connect, manage }: {
  options: Record<string, ProviderOptions> | null | undefined; ready: Record<string, boolean | undefined>;
  connect: (provider: string) => ReactNode; manage: (provider: string) => ReactNode;
}) {
  const id = useId();
  const [saved, setSaved] = useState<ModelChoice | null | undefined>(undefined); // undefined until loaded
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<ModelChoice>({ provider: "claude", model: "", effort: "" });
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const changeButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLDivElement>(null);

  useEffect(() => {
    backendRequest<ModelData>("/transcription-models").then((result) => {
      setSaved(result.configured);
      if (result.configured) setChoice(result.configured);
    }).catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load the model."));
  }, []);

  const way = wayOf(choice.provider);
  const list = modelsOf(options?.[choice.provider]);
  const subscription = SIGN_IN.includes(choice.provider);
  const efforts = choice.model ? effortsOf(choice.provider, choice.model) : [];

  // The efforts a model lists, or its provider's when it lists none.
  function effortsOf(provider: string, model: string) {
    const o = options?.[provider];
    const m = o?.models.find((x) => x.value === model);
    return (m?.efforts?.length ? m.efforts : o?.efforts) ?? [];
  }

  // Change and Done swap the summary and the form; focus follows to the one now shown.
  function open() {
    setChoice(saved!);
    setSaveError("");
    setEditing(true);
    requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("button, select, input")?.focus());
  }
  function close() {
    setSaveError("");
    setEditing(false);
    requestAnimationFrame(() => changeButton.current?.focus());
  }

  async function save(next: ModelChoice) {
    setSaveError("");
    try {
      setSaved(await backendRequest<ModelChoice>("/transcription-defaults", json("PUT", next)));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the model.");
    }
  }

  // Every change goes through here: a complete choice that differs from the saved one is saved straight away.
  function commit(next: ModelChoice) {
    setChoice(next);
    if (next.model && next.effort && !same(next, saved)) void save(next);
  }
  function pickWay(w: (typeof WAYS)[number]) {
    pickProvider(saved && w.ids.includes(saved.provider) ? saved.provider : w.ids[0]);
  }
  function pickProvider(provider: string) {
    setChoice(saved?.provider === provider ? saved : { provider, model: "", effort: "" });
  }
  function pickModel(model: string) {
    // a subscription's effort is kept if the new model has it, else chosen again; API and local models have only "default"
    const effort = !subscription ? "default" : effortsOf(choice.provider, model).includes(choice.effort) ? choice.effort : "";
    commit({ ...choice, model, effort });
  }

  return (
    <section id="transcription-defaults" className="max-w-2xl space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Transcription model</h2>
      {loadError && <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>}
      {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}
      {saved && !editing && (
        <Card className="flex flex-row items-center gap-4 p-5">
          <ProviderLogo provider={saved.provider} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-semibold">{saved.model}{SIGN_IN.includes(saved.provider) && ` · ${saved.effort}`}</p>
            <p className="text-sm text-muted-foreground">{title(saved.provider)} · {providerBlurbs[saved.provider]}</p>
            {ready[saved.provider] === false ? (
              <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                <TriangleAlert aria-hidden="true" className="size-4 shrink-0" /> Not connected on this computer. Press Change to connect it.
              </p>
            ) : <div className="text-sm">{manage(saved.provider)}</div>}
          </div>
          <Button ref={changeButton} variant="outline" onClick={open}>Change</Button>
        </Card>
      )}
      {saved !== undefined && (editing || !saved) && (
        <Card ref={form} className="gap-5 p-5">
          <Field>
            <FieldLabel>How do you pay for the AI?</FieldLabel>
            <Segmented label="How you pay for the AI" value={way.label} onChange={(label) => pickWay(WAYS.find((w) => w.label === label)!)}
              options={WAYS.map((w) => ({ value: w.label, label: w.label }))} />
          </Field>
          {way.ids.length > 1 && (
            <Field>
              <FieldLabel htmlFor={`${id}-provider`}>Provider</FieldLabel>
              <NativeSelect id={`${id}-provider`} className="w-full" value={choice.provider} onChange={(e) => pickProvider(e.target.value)}>
                {way.ids.map((p) => <option key={p} value={p}>{title(p)}</option>)}
              </NativeSelect>
            </Field>
          )}
          {!ready[choice.provider] ? (
            <div className="space-y-3 text-sm">{connect(choice.provider)}</div>
          ) : !list ? (
            <form className={`grid items-start gap-4 ${subscription ? "sm:grid-cols-[minmax(0,1fr)_10rem]" : ""}`}
              onSubmit={(e) => { e.preventDefault(); commit({ ...choice, effort: subscription ? choice.effort : "default" }); }}
              onBlur={() => commit({ ...choice, effort: subscription ? choice.effort : "default" })}>
              <Field>
                <FieldLabel htmlFor={`${id}-model`}>Model</FieldLabel>
                <Input id={`${id}-model`} value={choice.model} placeholder="Model name" onChange={(e) => setChoice({ ...choice, model: e.target.value.trim() })} />
                <FieldDescription>{options === undefined ? "Loading its models…" : options?.[choice.provider]?.error ?? "Its models couldn't be listed, so type the model's name."}</FieldDescription>
              </Field>
              {subscription && (
                <Field>
                  <FieldLabel htmlFor={`${id}-effort`}>Effort</FieldLabel>
                  <Input id={`${id}-effort`} value={choice.effort} placeholder="medium" onChange={(e) => setChoice({ ...choice, effort: e.target.value.trim() })} />
                </Field>
              )}
            </form>
          ) : (
            <div className={`grid items-start gap-4 ${subscription ? "sm:grid-cols-[minmax(0,1fr)_10rem]" : ""}`}>
              <Field>
                <FieldLabel htmlFor={`${id}-model`}>Model</FieldLabel>
                <NativeSelect id={`${id}-model`} className="w-full" value={choice.model} onChange={(e) => pickModel(e.target.value)}>
                  <option value="" disabled>Choose a model…</option>
                  {choice.model && !list!.some((m) => m.value === choice.model) && <option value={choice.model}>{choice.model}</option>}
                  {list!.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </NativeSelect>
              </Field>
              {subscription && (
                <Field>
                  <FieldLabel htmlFor={`${id}-effort`}>Effort</FieldLabel>
                  <NativeSelect id={`${id}-effort`} className="w-full" value={choice.effort} disabled={!choice.model}
                    onChange={(e) => commit({ ...choice, effort: e.target.value })}>
                    <option value="" disabled>Choose…</option>
                    {[...new Set([...efforts, choice.effort])].filter(Boolean).map((x) => <option key={x} value={x}>{x}</option>)}
                  </NativeSelect>
                </Field>
              )}
            </div>
          )}
          {ready[choice.provider] && <div className="text-sm">{manage(choice.provider)}</div>}
          {saved && (
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}
