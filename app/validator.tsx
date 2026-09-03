"use client";

import { useState, useMemo, Fragment } from "react";
import SearchBar from "./searchbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface SchemaItem {
  url: string;
  type: string;
  data: Record<string, any>;
  warnings: string[];
  valid: boolean;
}

// Required fields for common schema types
const REQUIRED_FIELDS: Record<string, string[]> = {
  Article: ["headline", "author", "datePublished", "image"],
  NewsArticle: ["headline", "author", "datePublished", "image"],
  BlogPosting: ["headline", "author", "datePublished"],
  Product: ["name", "image", "offers"],
  Organization: ["name", "url"],
  WebSite: ["name", "url"],
  WebPage: ["name"],
  LocalBusiness: ["name", "address", "telephone"],
  Person: ["name"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  HowTo: ["name", "step"],
  Recipe: ["name", "recipeIngredient", "recipeInstructions"],
  Event: ["name", "startDate", "location"],
  VideoObject: ["name", "description", "thumbnailUrl", "uploadDate"],
  ImageObject: ["contentUrl"],
  Review: ["itemReviewed", "reviewRating", "author"],
  AggregateRating: ["ratingValue", "reviewCount"],
  JobPosting: ["title", "description", "datePosted", "hiringOrganization"],
  Course: ["name", "description", "provider"],
  SoftwareApplication: ["name", "offers"],
};

const TYPE_COLORS: Record<string, string> = {
  Article: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  NewsArticle: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  BlogPosting: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  Product: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  Organization: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  WebSite: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  WebPage: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  LocalBusiness: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  Person: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  BreadcrumbList: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  FAQPage: "bg-teal-500/15 text-teal-400 border-teal-500/20",
  HowTo: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  Recipe: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  Event: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  VideoObject: "bg-red-500/15 text-red-400 border-red-500/20",
  Review: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/20",
};

type SortKey = "url" | "type" | "warnings";
type SortDir = "asc" | "desc";
type FilterStatus = "all" | "valid" | "warnings";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className={`inline ml-1 ${active ? "text-[#3bde77]" : "text-muted-foreground/40"}`}>
      <path d="M6 2L9 5H3L6 2Z" fill="currentColor" opacity={active && dir === "asc" ? 1 : 0.3} />
      <path d="M6 10L3 7H9L6 10Z" fill="currentColor" opacity={active && dir === "desc" ? 1 : 0.3} />
    </svg>
  );
}

function extractSchemaFromHtml(html: string): any[] {
  const schemas: any[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) schemas.push(...parsed);
      else schemas.push(parsed);
    } catch {}
  }
  return schemas;
}

function validateSchema(data: Record<string, any>): string[] {
  const warnings: string[] = [];
  const type = data["@type"] || "";
  if (!data["@type"]) warnings.push("Missing @type property");
  if (!data["@context"] && !data["@id"]) warnings.push("Missing @context");

  const required = REQUIRED_FIELDS[type];
  if (required) {
    for (const field of required) {
      if (!data[field] && data[field] !== 0 && data[field] !== false) {
        warnings.push(`Missing recommended field: ${field}`);
      }
    }
  }

  // Check for empty string values in important fields
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.trim() === "" && key !== "@context") {
      warnings.push(`Empty value for: ${key}`);
    }
  }

  return warnings;
}

export default function Validator() {
  const [data, setData] = useState<any[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("warnings");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const { toast } = useToast();

  const schemas = useMemo(() => {
    if (!data?.length) return [];
    const items: SchemaItem[] = [];

    for (const page of data) {
      if (!page?.url) continue;

      // Try json_data from API response first
      let jsonData: any[] = [];
      if (page.json_data) {
        if (Array.isArray(page.json_data)) jsonData = page.json_data;
        else if (typeof page.json_data === "object") jsonData = [page.json_data];
      }

      // Also parse from HTML content as fallback
      if (page.content && typeof page.content === "string") {
        const htmlSchemas = extractSchemaFromHtml(page.content);
        jsonData = [...jsonData, ...htmlSchemas];
      }

      // Handle @graph arrays
      const flattened: any[] = [];
      for (const item of jsonData) {
        if (item?.["@graph"] && Array.isArray(item["@graph"])) {
          for (const g of item["@graph"]) flattened.push({ ...g, "@context": g["@context"] || item["@context"] });
        } else {
          flattened.push(item);
        }
      }

      // Dedupe by stringified content
      const seen = new Set<string>();
      for (const item of flattened) {
        const key = JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);

        const type = item?.["@type"] || "Unknown";
        const warnings = validateSchema(item);
        items.push({
          url: page.url,
          type: Array.isArray(type) ? type.join(", ") : type,
          data: item,
          warnings,
          valid: warnings.length === 0,
        });
      }
    }

    return items;
  }, [data]);

  const filtered = useMemo(() => {
    let list = schemas;
    if (filter === "valid") list = list.filter((s) => s.valid);
    else if (filter === "warnings") list = list.filter((s) => !s.valid);

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "url") cmp = a.url.localeCompare(b.url);
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else if (sortKey === "warnings") cmp = a.warnings.length - b.warnings.length;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [schemas, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const pageCount = data?.filter((p) => p?.url).length || 0;
  const validCount = schemas.filter((s) => s.valid).length;
  const warningCount = schemas.filter((s) => !s.valid).length;

  // Unique types
  const typeBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of schemas) {
      map.set(s.type, (map.get(s.type) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [schemas]);

  const exportResults = (format: "json" | "csv" | "md") => {
    if (!filtered.length) return;
    let content = "";
    if (format === "json") {
      content = JSON.stringify(filtered.map((s) => ({ url: s.url, type: s.type, valid: s.valid, warnings: s.warnings, data: s.data })), null, 2);
    } else if (format === "csv") {
      content = "URL,Type,Valid,Warnings\n" + filtered.map((s) => `"${s.url}","${s.type}",${s.valid},"${s.warnings.join("; ")}"`).join("\n");
    } else {
      content = "# Schema Validation Report\n\n| URL | Type | Status | Warnings |\n|---|---|---|---|\n" + filtered.map((s) => {
        let path = s.url;
        try { path = new URL(s.url).pathname; } catch {}
        return `| ${path} | ${s.type} | ${s.valid ? "Valid" : "Issues"} | ${s.warnings.length} |`;
      }).join("\n");
    }
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `schema-report.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "Exported", description: `Downloaded schema-report.${format}` });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SearchBar setDataValues={setData} />
      <div className="flex-1 overflow-auto">
        {!data ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4 py-20">
            <svg height={48} width={48} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="fill-[#3bde77]/30">
              <path fillRule="evenodd" clipRule="evenodd" d="M20.646 5.196A2.25 2.25 0 0 0 17.199 2.304L15.447 4.391A4.5 4.5 0 0 1 8.553 4.391L6.801 2.304A2.25 2.25 0 0 0 3.354 5.196L8.697 11.564A4.5 4.5 0 0 1 9.75 14.457L9.75 20.25A2.25 2.25 0 0 0 14.25 20.25L14.25 14.457A4.5 4.5 0 0 1 15.303 11.564L20.646 5.196Z" />
            </svg>
            <h2 className="text-xl font-bold">Spider Schema Validator</h2>
            <p className="text-muted-foreground max-w-md">
              Validate JSON-LD structured data on any website. Check Schema.org markup, see rich result eligibility, and fix errors.
            </p>
          </div>
        ) : schemas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-20 text-muted-foreground">
            <p>No structured data found.</p>
            <p className="text-sm">This site may not have JSON-LD or Schema.org markup.</p>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto p-4 space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Schema Items</p>
                <p className="text-2xl font-bold text-[#3bde77]">{schemas.length}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Valid</p>
                <p className="text-2xl font-bold text-green-400">{validCount}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">With Warnings</p>
                <p className="text-2xl font-bold text-yellow-400">{warningCount}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Pages Scanned</p>
                <p className="text-2xl font-bold">{pageCount}</p>
              </div>
            </div>

            {/* Type breakdown pills */}
            {typeBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {typeBreakdown.map(([type, count]) => (
                  <Badge key={type} variant="outline" className={`text-xs ${TYPE_COLORS[type] || "bg-muted text-muted-foreground border-muted"}`}>
                    {type} ({count})
                  </Badge>
                ))}
              </div>
            )}

            {/* Filter + Export */}
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "valid", "warnings"] as FilterStatus[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filter === f
                      ? "bg-[#3bde77]/15 text-[#3bde77] border-[#3bde77]/30"
                      : "bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/20"
                  }`}
                >
                  {f === "all" ? `All (${schemas.length})` : f === "valid" ? `Valid (${validCount})` : `Warnings (${warningCount})`}
                </button>
              ))}
              <div className="flex-1" />
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportResults("json")}>JSON</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportResults("csv")}>CSV</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportResults("md")}>MD</Button>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="w-8 p-3" />
                    <th className="text-left p-3 font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("url")}>
                      Page <SortIcon active={sortKey === "url"} dir={sortDir} />
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("type")}>
                      Type <SortIcon active={sortKey === "type"} dir={sortDir} />
                    </th>
                    <th className="text-center p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("warnings")}>
                      Warnings <SortIcon active={sortKey === "warnings"} dir={sortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((schema, idx) => {
                    let pathname = schema.url;
                    try { pathname = new URL(schema.url).pathname; } catch {}
                    const isExpanded = expanded.has(idx);
                    return (
                      <Fragment key={idx}>
                        <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => toggleExpand(idx)}>
                          <td className="p-3 text-muted-foreground">
                            <svg width="12" height="12" viewBox="0 0 12 12" className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                              <path d="M4 2L8 6L4 10" fill="none" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                          </td>
                          <td className="p-3 font-mono text-xs truncate max-w-[200px]" title={schema.url}>{pathname}</td>
                          <td className="p-3">
                            <Badge variant="outline" className={`text-xs ${TYPE_COLORS[schema.type] || "bg-muted text-muted-foreground border-muted"}`}>
                              {schema.type}
                            </Badge>
                          </td>
                          <td className="p-3 text-center">
                            {schema.valid ? (
                              <Badge variant="outline" className="text-xs bg-green-500/15 text-green-400 border-green-500/20">Valid</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs bg-yellow-500/15 text-yellow-400 border-yellow-500/20">Issues</Badge>
                            )}
                          </td>
                          <td className="p-3 text-right font-mono text-xs">{schema.warnings.length}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b bg-muted/10">
                            <td colSpan={5} className="p-4">
                              {schema.warnings.length > 0 && (
                                <div className="mb-3 space-y-1">
                                  <p className="text-xs font-medium text-yellow-400 mb-1">Warnings:</p>
                                  {schema.warnings.map((w, i) => (
                                    <p key={i} className="text-xs text-muted-foreground pl-3 border-l-2 border-yellow-500/30">{w}</p>
                                  ))}
                                </div>
                              )}
                              <p className="text-xs font-medium text-muted-foreground mb-1">Raw JSON-LD:</p>
                              <pre className="text-xs bg-background/50 rounded border p-3 overflow-x-auto max-h-64 overflow-y-auto">
                                {JSON.stringify(schema.data, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
