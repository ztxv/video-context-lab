import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { audioIsSilent, detectScenes, extractAudio, extractFrames, inspectVideo, selectFrames, timecode, validateDuration } from "../src/lib/media.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const testRoot = path.join(process.cwd(), "work", "tests");
import { mkdir } from "node:fs/promises";

function makeVideo(args) {
  const command = process.env.FFMPEG_PATH || "ffmpeg";
  const result = spawnSync(command, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test("time and frame selection preserve broad timeline coverage", () => {
  assert.equal(timecode(14.671), "00:14.671");
  assert.throws(() => validateDuration(60.2), /limit is 60 seconds/);
  const frames = selectFrames(60, [1, 1.1, 1.2, 16, 31, 45]);
  assert.ok(frames.length >= 8 && frames.length <= 16);
  assert.equal(frames[0].timestamp, 0);
  assert.equal(frames[0].reason, "opening frame");
  assert.ok(frames.at(-1).timestamp > 55);
  assert.ok(frames.slice(1).every((frame, i) => frame.timestamp - frames[i].timestamp < 7));
  assert.ok(frames.some(frame => frame.reason === "scene change"));
});

test("FFmpeg metadata, audio and selected frames work on a real clip", async () => {
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(path.join(testRoot, "video-context-test-"));
  try {
    const file = path.join(dir, "demo.mp4");
    makeVideo(["-f", "lavfi", "-i", "color=c=red:s=320x180:d=1.5:r=10", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1.5:r=10", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac", file]);
    const info = await inspectVideo(file);
    assert.ok(info.duration >= 2.9 && info.duration <= 3.1);
    assert.equal(info.width, 320);
    assert.match(info.format, /mov|mp4/);
    assert.equal(info.hasAudio, true);
    const audio = await extractAudio(file, dir);
    assert.ok((await stat(audio)).size > 0);
    assert.equal(await audioIsSilent(audio), false);
    const scenes = await detectScenes(file);
    assert.ok(scenes.some(time => time > 1 && time < 2), `Expected the red-to-blue scene change, got ${scenes}`);
    const frames = await extractFrames(file, dir, selectFrames(info.duration, scenes));
    assert.ok(frames.length >= 2);
    assert.ok(frames.some(frame => frame.timestamp > 1));
    assert.ok(frames.some(frame => frame.reason === "scene change"));
    for (const frame of frames) assert.ok((await stat(frame.path)).size > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("videos beyond 60 seconds are rejected from their actual metadata", async () => {
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(path.join(testRoot, "video-context-test-"));
  try {
    const file = path.join(dir, "long.mp4");
    makeVideo(["-f", "lavfi", "-i", "color=c=black:s=32x32:r=1:d=61", "-c:v", "mpeg4", file]);
    await assert.rejects(inspectVideo(file), /limit is 60 seconds/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
