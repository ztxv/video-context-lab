import { readFile } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const job = getJob(id);
  const frameIndex = Number(index);
  if (!job || job.phase !== "ready" || !Number.isInteger(frameIndex) || frameIndex < 0) return new Response("Frame unavailable", { status: 404 });
  const frame = job.context?.frames[frameIndex];
  if (!frame) return new Response("Frame unavailable", { status: 404 });
  const root = path.resolve(job.dir) + path.sep;
  const target = path.resolve(frame.path);
  if (!target.startsWith(root)) return new Response("Frame unavailable", { status: 404 });
  try {
    const image = await readFile(target);
    return new Response(image, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Frame unavailable", { status: 404 }); }
}
