import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { VideoJob } from "./types";
import { processingRoot } from "./storage";

const TTL = 2 * 60 * 60 * 1000;
const globalJobs = globalThis as typeof globalThis & { __videoContextJobs?: Map<string, VideoJob> };
const jobs = globalJobs.__videoContextJobs ??= new Map<string, VideoJob>();

export function addJob(job: VideoJob) { jobs.set(job.id, job); }
export function getJob(id: string) {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (Date.now() - job.createdAt > TTL) { void removeJob(id); return undefined; }
  return job;
}
export async function removeJob(id: string) {
  const job = jobs.get(id);
  jobs.delete(id);
  if (job) await rm(job.dir, { recursive: true, force: true }).catch(() => {});
}
export async function cleanExpired() {
  for (const job of jobs.values()) if (Date.now() - job.createdAt > TTL) await removeJob(job.id);
}

const timer = setInterval(() => { void cleanExpired(); }, 15 * 60 * 1000);
timer.unref();

// Jobs are in memory; reclaim temporary videos left by a previous server process.
void (async () => {
  const root = processingRoot();
  for (const name of await readdir(root).catch(() => [])) {
    if (!/^video-context-[\w-]+$/.test(name)) continue;
    const target = path.join(root, name);
    const info = await stat(target).catch(() => undefined);
    if (info?.isDirectory() && Date.now() - info.mtimeMs > TTL) await rm(target, { recursive: true, force: true }).catch(() => {});
  }
})();
