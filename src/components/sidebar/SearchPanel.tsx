import { FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { useWorkspace } from "@/stores/workspace";
import type { SearchHit } from "@/types";

const SEARCH_DEBOUNCE_MS = 220;

export function SearchPanel() {
  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);
  const selectNote = useWorkspace((state) => state.selectNote);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setHits([]);
      setSearching(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const result = await api.searchNotes(activeWorkspaceId, trimmed);
        if (!cancelled) {
          setHits(result);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setHits([]);
          setError(errorMessage(caught));
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeWorkspaceId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 p-2">
        <input
          className="field w-full"
          placeholder="搜索全部笔记…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && <p className="px-1 py-3 text-xs text-danger">{error}</p>}

        {!error && query.trim().length > 0 && hits.length === 0 && !searching && (
          <p className="px-1 py-3 text-xs text-muted">没有匹配的笔记</p>
        )}

        <ul className="flex flex-col gap-1">
          {hits.map((hit) => (
            <li key={hit.noteId}>
              <button
                type="button"
                className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-default/60"
                onClick={() => void selectNote(hit.noteId)}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <FileText className="size-3.5 shrink-0 opacity-50" />
                  <span className="truncate">{hit.title}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">{hit.relPath}</span>
                {hit.snippet && (
                  <span className="mt-1 block line-clamp-2 text-xs text-foreground/70">
                    {hit.snippet}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
