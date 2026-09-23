export type AnalysisSection = "overview" | "timeline" | "technical" | "reverse" | "evidence" | "recreation";

const headings: Record<string, AnalysisSection> = {
  "what the video shows": "overview",
  "overview": "overview",
  "timeline": "timeline",
  "technical interpretation": "technical",
  "what is happening technically": "technical",
  "reverse engineering": "reverse",
  "reverse engineer": "reverse",
  "observed vs inferred": "evidence",
  "what can actually be inferred": "evidence",
  "recreation path": "recreation",
};

export function parseAnalysis(text: string): Record<AnalysisSection, string> {
  const sections: Record<AnalysisSection, string[]> = { overview: [], timeline: [], technical: [], reverse: [], evidence: [], recreation: [] };
  let current: AnalysisSection = "overview";
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const next = headings[heading[1].toLowerCase().replace(/\*\*/g, "").trim()];
      if (next) { current = next; continue; }
    }
    sections[current].push(line);
  }
  return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()])) as Record<AnalysisSection, string>;
}

export function parseTimestamp(token: string): number | null {
  const clean = token.replace(/^\[/, "").replace(/\]$/, "");
  if (!/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/.test(clean)) return null;
  const parts = clean.split(":").map(Number);
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number.isFinite(seconds) ? seconds : null;
}

export function formatTimestamp(seconds: number, precise = false): string {
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60000);
  const remainder = ms % 60000;
  const base = `${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 1000)).padStart(2, "0")}`;
  return precise ? `${base}.${String(remainder % 1000).padStart(3, "0")}` : base;
}
