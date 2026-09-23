import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { processVideo } from "@/lib/engine";
import { addJob } from "@/lib/sessions";
import { processingRoot } from "@/lib/storage";
import type { VideoJob } from "@/lib/types";

export const runtime = "nodejs";
const MAX_BYTES = 250 * 1024 * 1024;
const types: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length"));
    if (length > MAX_BYTES + 1024 * 1024) return Response.json({ error: "The file is too large. Limit: 250 MB." }, { status: 413 });
    const form = await request.formData();
    const file = form.get("video");
    if (!(file instanceof File)) return Response.json({ error: "Choose an MP4, MOV, or WebM video." }, { status: 400 });
    const filename = path.basename(file.name).slice(0, 180) || "video";
    const extension = path.extname(filename).toLowerCase();
    if (!types[extension]) return Response.json({ error: "Choose an MP4, MOV, or WebM video." }, { status: 400 });
    if (!file.size || file.size > MAX_BYTES) return Response.json({ error: "The file must be nonempty and no larger than 250 MB." }, { status: 413 });
    const root = processingRoot();
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(path.join(root, "video-context-"));
    const id = randomUUID();
    const videoPath = path.join(dir, `video${extension}`);
    try { await writeFile(videoPath, Buffer.from(await file.arrayBuffer())); }
    catch (error) { const { rm } = await import("node:fs/promises"); await rm(dir, { recursive: true, force: true }); throw error; }
    const job: VideoJob = { id, phase: "reading", dir, videoPath, mime: types[extension], createdAt: Date.now(), history: [] };
    addJob(job);
    void processVideo(job, filename, { type: "upload" });
    return Response.json({ id }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 500 });
  }
}
