"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { Issue } from "@/shared/types";
import { api } from "@/shared/api";
import { StatusIcon } from "@/features/issues";
import { STATUS_CONFIG } from "@/features/issues/config";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

export function SearchCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setIsLoading(false);
    }
  }, [open]);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!q.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await api.searchIssues({ q: q.trim(), limit: 20, signal: controller.signal });
        if (!controller.signal.aborted) {
          setResults(res.issues);
          setIsLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);
  }, []);

  const handleValueChange = useCallback(
    (value: string) => {
      setQuery(value);
      search(value);
    },
    [search],
  );

  const handleSelect = useCallback(
    (issueId: string) => {
      setOpen(false);
      router.push(`/issues/${issueId}`);
    },
    [router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search Issues"
      description="Search issues by title or description"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search issues..."
          value={query}
          onValueChange={handleValueChange}
        />
        <CommandList>
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && query.trim() && results.length === 0 && (
            <CommandEmpty>No issues found.</CommandEmpty>
          )}
          {!isLoading && results.length > 0 && (
            <CommandGroup heading="Issues">
              {results.map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={issue.id}
                  onSelect={handleSelect}
                  className="gap-3"
                >
                  <StatusIcon status={issue.status} className="size-4 shrink-0" />
                  <span className="text-xs text-muted-foreground shrink-0">
                    {issue.identifier}
                  </span>
                  <span className="truncate">{issue.title}</span>
                  <span
                    className={`ml-auto text-xs shrink-0 ${STATUS_CONFIG[issue.status].iconColor}`}
                  >
                    {STATUS_CONFIG[issue.status].label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!isLoading && !query.trim() && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type to search issues...
            </div>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
