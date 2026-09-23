"use client";

import { parseTimestamp } from "@/lib/presentation";

const tokenPattern = /(\*\*[^*]+\*\*|\[?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\]?)/g;

export function RichText({ text, duration, seek }: { text: string; duration: number; seek: (seconds: number) => void }) {
  function inline(value: string, bold = true): React.ReactNode[] {
    return value.split(tokenPattern).map((part, index) => {
      if (bold && part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{inline(part.slice(2, -2), false)}</strong>;
      const seconds = parseTimestamp(part);
      if (seconds !== null && seconds <= duration + 1) return <button key={index} type="button" className="timestamp" title={`Jump to ${part}`} onClick={() => seek(seconds)}>{part}</button>;
      return part;
    });
  }

  return <div className="rich-text">{text.split(/\r?\n/).map((raw, index) => {
    const line = raw.trim();
    if (!line) return <div key={index} className="spacer" />;
    if (/^#{1,4}\s/.test(line)) return <h3 key={index}>{inline(line.replace(/^#{1,4}\s*/, ""))}</h3>;
    if (/^[-*]\s/.test(line)) return <p key={index} className="bullet">{inline(line.slice(2))}</p>;
    if (/^\d+\.\s/.test(line)) return <p key={index} className="numbered">{inline(line)}</p>;
    if (line.startsWith("|")) return <p key={index} className="table-line">{inline(line)}</p>;
    return <p key={index}>{inline(line)}</p>;
  })}</div>;
}
