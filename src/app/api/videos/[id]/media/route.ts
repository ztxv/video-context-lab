import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getJob } from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job || job.phase !== "ready") return new Response("Video unavailable", { status: 404 });
  const playbackPath = job.playbackPath || job.videoPath;
  const size = (await stat(playbackPath)).size;
  const range = request.headers.get("range");
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, size - suffix); }
    else { start = Number(match[1]); if (match[2]) end = Number(match[2]); }
    if (start >= size || end < start || !Number.isFinite(start) || !Number.isFinite(end)) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    end = Math.min(end, size - 1);
  }
  const stream = Readable.toWeb(createReadStream(playbackPath, { start, end })) as ReadableStream;
  const headers: Record<string, string> = { "Content-Type": job.playbackMime || job.mime, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(stream, { status: range ? 206 : 200, headers });
}
