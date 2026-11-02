import { useState } from "react";
import { ExternalLink } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { backendRequest, type ApiKey } from "../progress/backend";

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Saving, replacing or removing one provider's key; onChange gets every key's new state. Keys stay on this computer, never in
// the database or a PrestCribe file, and are never shown again.
export function KeyForm({ k, onChange }: { k: ApiKey; onChange: (keys: ApiKey[]) => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(key: string) {
    setBusy(true);
    setError("");
    try {
      onChange(await backendRequest<ApiKey[]>(`/api-keys/${k.provider}`, json("PUT", { key })));
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the key.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {k.needsKey && (
          <form className="flex w-full items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(draft); }}>
            <Input type="password" autoComplete="off" aria-label={`${k.label} key`} className="min-w-0 flex-1"
              placeholder={k.saved ? "Paste a new key to replace it" : "Paste a key"} value={draft}
              onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" size="sm" disabled={busy || !draft.trim()}>Save</Button>
            {k.saved && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => save("")}>Remove</Button>}
          </form>
        )}
        <a href={k.keysUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
          {k.needsKey ? "Get a key" : "Get Ollama"} <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  );
}
