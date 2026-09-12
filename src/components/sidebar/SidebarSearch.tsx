import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

const SEARCH_DEBOUNCE_MS = 220;

/**
 * The sidebar's search box, on its own row above the file tree.
 *
 * It used to be a panel of its own, which meant searching hid the tree — and the
 * folder a note lives in is exactly what a bare list of results cannot tell you.
 * Now it publishes its hits and the tree narrows to them, so the structure around
 * a match stays on screen.
 */
export function SidebarSearch() {
  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);
  const setSearchHits = useUi((state) => state.setSearchHits);

  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Results are note ids, so they stop meaning anything once the workspace
  // changes: the box empties with it.
  useEffect(() => {
    setQuery("");
  }, [activeWorkspaceId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setSearchHits(null);
      setError(null);
      return;
    }

    let cancelled = false;

    // The previous hits stay published until the new ones land: the tree then
    // holds its shape while typing instead of emptying on every keystroke, and an
    // empty array only ever means a settled search that matched nothing.
    const timer = setTimeout(async () => {
      try {
        const hits = await api.searchNotes(activeWorkspaceId, trimmed);
        if (cancelled) return;
        setSearchHits(hits);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setSearchHits([]);
        setError(errorMessage(caught));
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeWorkspaceId, setSearchHits]);

  // Unmounting leaves the tree filtered by a query nobody can see any more.
  useEffect(() => () => setSearchHits(null), [setSearchHits]);

  return (
    <div className="border-b border-border/80 px-2 py-1.5">
      <div className="field flex items-center gap-1.5 px-2 py-1">
        <Search className="size-4 shrink-0 opacity-50" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          placeholder="搜索全部笔记…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          aria-label="搜索全部笔记"
        />
        {query.length > 0 && (
          <button
            type="button"
            aria-label="清除搜索"
            title="清除搜索（Esc）"
            className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            onClick={() => setQuery("")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {error && <p className="px-1 pt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
