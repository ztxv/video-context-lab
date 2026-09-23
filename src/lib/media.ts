import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FrameSelection, TranscriptSegment } from "./types";

const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = () => process.env.FFPROBE_PATH || "ffprobe";

export function timecode(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60000);
  const remainder = ms % 60000;
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 1000)).padStart(2, "0")}.${String(remainder % 1000).padStart(3, "0")}`;
}

export function validateDuration(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read the video duration.");
  if (duration > 60) throw new Error(`This video is ${timecode(duration)} long. The V1 limit is 60 seconds.`);
}

async function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", () => reject(new Error(`${path.basename(binary)} is unavailable. Install FFmpeg or set FFMPEG_PATH and FFPROBE_PATH.`)));
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(binary)} failed: ${output.slice(-1600)}`)));
  });
}

export async function inspectVideo(videoPath: string) {
  const output = await run(ffprobe(), ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height", "-of", "json", videoPath]);
  let data: { format?: { duration?: string; format_name?: string }; streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[] };
  try { data = JSON.parse(output); } catch { throw new Error("Could not read video metadata."); }
  const video = data.streams?.find(stream => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("The file does not contain a readable video stream.");
  const duration = Number(data.format?.duration);
  validateDuration(duration);
  const audio = data.streams?.find(stream => stream.codec_type === "audio");
  return { duration, width: video.width, height: video.height, format: data.format?.format_name || "unknown", videoCodec: video.codec_name || "unknown", audioCodec: audio?.codec_name, hasAudio: Boolean(audio) };
}

export async function preparePlayback(videoPath: string, dir: string, mime: string, metadata: Awaited<ReturnType<typeof inspectVideo>>) {
  const mp4Ready = mime === "video/mp4" && metadata.format.includes("mp4") && metadata.videoCodec === "h264" && (!metadata.hasAudio || metadata.audioCodec === "aac");
  const webmReady = mime === "video/webm" && metadata.format.includes("webm") && ["vp8", "vp9", "av1"].includes(metadata.videoCodec) && (!metadata.hasAudio || ["opus", "vorbis"].includes(metadata.audioCodec || ""));
  if (mp4Ready || webmReady) return { path: videoPath, mime };
  const playbackPath = path.join(dir, "playback.mp4");
  await run(ffmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", playbackPath]);
  return { path: playbackPath, mime: "video/mp4" };
}

export async function extractAudio(videoPath: string, dir: string): Promise<string> {
  const audioPath = path.join(dir, "audio.mp3");
  await run(ffmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", audioPath]);
  return audioPath;
}

export async function audioIsSilent(audioPath: string): Promise<boolean> {
  const output = await run(ffmpeg(), ["-hide_banner", "-i", audioPath, "-af", "volumedetect", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
  const match = output.match(/max_volume:\s*(-?\d+(?:\.\d+)?|[-]inf) dB/);
  return match ? match[1] === "-inf" || Number(match[1]) < -65 : false;
}

export function selectFrames(duration: number, scenes: number[]): FrameSelection[] {
  const target = Math.min(16, Math.max(1, Math.ceil(duration / 4), Math.min(4, Math.ceil(duration))));
  const last = Math.max(0, duration - 0.25);
  const step = last / Math.max(1, target - 1);
  const candidates = scenes.filter(t => Number.isFinite(t) && t > 0 && t < last);
  const selected: FrameSelection[] = Array.from({ length: target }, (_, i) => {
    const slot = i * step;
    if (i === 0) return { timestamp: slot, reason: "opening frame" };
    if (i === target - 1) return { timestamp: slot, reason: "final frame" };
    const nearby = candidates.filter(t => Math.abs(t - slot) < step * 0.5).sort((a, b) => Math.abs(a - slot) - Math.abs(b - slot));
    return nearby.length ? { timestamp: nearby[0], reason: "scene change" } : { timestamp: slot, reason: "coverage sample" };
  });
  return selected.sort((a, b) => a.timestamp - b.timestamp);
}

export async function detectScenes(videoPath: string): Promise<number[]> {
  const output = await run(ffmpeg(), ["-hide_banner", "-i", videoPath, "-vf", "select='gt(scene,0.25)',showinfo", "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
  return [...output.matchAll(/pts_time:([0-9.]+)/g)].map(match => Number(match[1]));
}

export async function extractFrames(videoPath: string, dir: string, selections: FrameSelection[]) {
  const framesDir = path.join(dir, "frames");
  await mkdir(framesDir, { recursive: true });
  const frames: (FrameSelection & { path: string })[] = [];
  for (const [index, selection] of selections.entries()) {
    const framePath = path.join(framesDir, `${String(index + 1).padStart(3, "0")}.jpg`);
    for (const backoff of [0, 0.5, 1.5, 3]) {
      const seek = Math.max(0, selection.timestamp - backoff);
      const output = await run(ffmpeg(), ["-hide_banner", "-y", "-ss", seek.toFixed(3), "-copyts", "-i", videoPath, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2,format=yuvj420p,showinfo", "-q:v", "3", framePath]);
      const image = await stat(framePath).catch(() => undefined);
      if (!image?.size) continue;
      const match = output.match(/n:\s*0\s+pts:\s*-?\d+\s+pts_time:(-?\d+(?:\.\d+)?)/);
      if (!match) throw new Error("Could not determine a keyframe's original timestamp.");
      frames.push({ ...selection, timestamp: Number(match[1]), path: framePath });
      break;
    }
  }
  if (!frames.length) throw new Error("Could not extract visual frames from this video.");
  return frames;
}

export async function frameDataUrl(framePath: string): Promise<string> {
  return `data:image/jpeg;base64,${(await readFile(framePath)).toString("base64")}`;
}

export function nearbySpeech(segments: TranscriptSegment[], at: number): string {
  return segments.filter(s => s.start <= at + 4 && s.end >= at - 4).map(s => s.text).join(" ");
}
