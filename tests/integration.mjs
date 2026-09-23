import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import test from "node:test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); });

test("real upload and media processing feed timestamped analysis and continued chat", async () => {
  assert.ok(existsSync(".next/BUILD_ID"), "Run npm run build before this integration test.");
  const work = path.join(process.cwd(), "work", "integration");
  await mkdir(work, { recursive: true });
  const file = path.join(work, "demo.mp4");
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const media = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "aac", file], { encoding: "utf8" });
  assert.equal(media.status, 0, media.stderr || media.error?.message);

  const seen = { transcriptions: [], responses: [] };
  const mock = http.createServer(async (request, reply) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    reply.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/audio/transcriptions") {
      seen.transcriptions.push(body);
      reply.end(JSON.stringify({ text: "This is a demo transcript.", segments: [{ start: 0, end: 3, text: "This is a demo transcript." }] }));
    } else if (request.url === "/v1/responses") {
      const input = JSON.parse(body);
      seen.responses.push(input);
      const chat = Boolean(input.previous_response_id);
      reply.end(JSON.stringify({ id: `resp-${seen.responses.length}`, output: [{ type: "message", content: [{ type: "output_text", text: chat ? "## What was built\nThe implementation could use a canvas at 00:01." : "## What the video shows\nA visual demo at 00:01.\n## Timeline\n00:01: A frame changes." }] }] }));
    } else { reply.statusCode = 404; reply.end("{}"); }
  });
  await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
  const mockPort = mock.address().port;
  const appPort = await port();
  const temp = path.join(work, "temp");
  await mkdir(temp, { recursive: true });
  const app = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(appPort)], {
    cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OPENAI_API_KEY: "local-test-key", OPENAI_API_BASE_URL: `http://127.0.0.1:${mockPort}/v1`, TEMP: temp, TMP: temp },
  });
  let serverOutput = "";
  app.stdout.on("data", chunk => { serverOutput += chunk.toString(); });
  app.stderr.on("data", chunk => { serverOutput += chunk.toString(); });

  try {
    const base = `http://127.0.0.1:${appPort}`;
    let available = false;
    for (let i = 0; i < 100; i++) {
      if (app.exitCode !== null) throw new Error(`App exited before startup: ${serverOutput}`);
      try { const result = await fetch(base); if (result.ok) { available = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(available, `App did not start: ${serverOutput}`);
    const form = new FormData();
    form.set("video", new File([await readFile(file)], "Original Developer Demo.mp4", { type: "video/mp4" }));
    const accepted = await fetch(`${base}/api/videos/analyze`, { method: "POST", body: form });
    assert.equal(accepted.status, 202);
    const { id } = await accepted.json();
    let status;
    for (let i = 0; i < 150; i++) {
      const result = await fetch(`${base}/api/videos/${id}`);
      status = await result.json();
      if (status.phase === "ready" || status.phase === "error") break;
      await sleep(100);
    }
    assert.equal(status.phase, "ready", JSON.stringify(status));
    assert.equal(status.video.filename, "Original Developer Demo.mp4");
    assert.equal(status.video.hasAudio, true);
    assert.match(status.video.format, /mov|mp4/);
    assert.equal(status.video.transcript.fullText, "This is a demo transcript.");
    assert.equal(status.video.transcript.segments[0].start, 0);
    assert.ok(status.video.frames.length >= 2);
    assert.ok(status.video.frames.every(frame => frame.reason && frame.imageUrl));
    assert.ok(status.video.analysis.includes("What the video shows"));
    assert.ok(seen.transcriptions[0].includes('name="timestamp_granularities[]"'));
    assert.ok(seen.transcriptions[0].includes('name="file"'));
    const initial = seen.responses[0];
    const firstImage = initial.input[0].content.find(part => part.type === "input_image");
    assert.ok(firstImage);
    assert.ok(initial.input[0].content.some(part => part.type === "input_text" && part.text.includes("This is a demo transcript.")));
    assert.ok(initial.input[0].content.some(part => part.type === "input_text" && part.text.includes("Selected by")));
    const inspectorFrame = await fetch(`${base}${status.video.frames[0].imageUrl}`);
    assert.equal(inspectorFrame.status, 200);
    assert.equal(inspectorFrame.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await inspectorFrame.arrayBuffer()).toString("base64"), firstImage.image_url.split(",")[1]);
    const mediaResponse = await fetch(`${base}/api/videos/${id}/media`, { headers: { Range: "bytes=0-99" } });
    assert.equal(mediaResponse.status, 206);
    assert.equal(mediaResponse.headers.get("content-type"), "video/mp4");
    assert.equal((await mediaResponse.arrayBuffer()).byteLength, 100);
    const playable = path.join(work, "playable.mp4");
    await writeFile(playable, Buffer.from(await (await fetch(`${base}/api/videos/${id}/media`)).arrayBuffer()));
    const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
    const playbackProbe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_name", "-of", "json", playable], { encoding: "utf8" });
    assert.equal(playbackProbe.status, 0, playbackProbe.stderr);
    assert.deepEqual(JSON.parse(playbackProbe.stdout).streams.map(stream => stream.codec_name), ["h264", "aac"]);
    const chatResponse = await fetch(`${base}/api/videos/${id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "How was it built?" }) });
    assert.equal(chatResponse.status, 200);
    assert.match((await chatResponse.json()).answer, /canvas/);
    assert.equal(seen.responses[1].previous_response_id, "resp-1");
    assert.equal(seen.transcriptions.length, 1, "Chat must not transcribe again");
    assert.equal(seen.responses[1].input[0].content.filter(part => part.type === "input_image").length, 0, "Chat must reuse stored visual context");
    const reverse = await fetch(`${base}/api/videos/${id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Reverse engineer this video. Cover observed, inferred, unknown, and an original MVP." }) });
    assert.equal(reverse.status, 200);
    assert.equal(seen.responses[2].previous_response_id, "resp-2");
    assert.equal(seen.transcriptions.length, 1);

    const silent = path.join(work, "silent.mp4");
    const silentMedia = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=180x320:r=10:d=3", "-c:v", "mpeg4", silent], { encoding: "utf8" });
    assert.equal(silentMedia.status, 0, silentMedia.stderr || silentMedia.error?.message);
    const silentForm = new FormData();
    silentForm.set("video", new File([await readFile(silent)], "Portrait Silent.mp4", { type: "video/mp4" }));
    const silentAccepted = await fetch(`${base}/api/videos/analyze`, { method: "POST", body: silentForm });
    assert.equal(silentAccepted.status, 202);
    const { id: silentId } = await silentAccepted.json();
    let silentStatus;
    for (let i = 0; i < 150; i++) {
      silentStatus = await (await fetch(`${base}/api/videos/${silentId}`)).json();
      if (["ready", "error"].includes(silentStatus.phase)) break;
      await sleep(100);
    }
    assert.equal(silentStatus.phase, "ready", JSON.stringify(silentStatus));
    assert.equal(silentStatus.video.filename, "Portrait Silent.mp4");
    assert.ok(silentStatus.video.height > silentStatus.video.width);
    assert.equal(silentStatus.video.hasAudio, false);
    assert.equal(seen.transcriptions.length, 1, "Silent video must skip transcription");

    const almostLong = path.join(work, "almost-long.mp4");
    const nearLimitMedia = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=2:d=59.5", "-c:v", "mpeg4", almostLong], { encoding: "utf8" });
    assert.equal(nearLimitMedia.status, 0, nearLimitMedia.stderr || nearLimitMedia.error?.message);
    const nearForm = new FormData();
    nearForm.set("video", new File([await readFile(almostLong)], "Almost Sixty.mp4", { type: "video/mp4" }));
    const nearAccepted = await fetch(`${base}/api/videos/analyze`, { method: "POST", body: nearForm });
    assert.equal(nearAccepted.status, 202);
    const { id: nearId } = await nearAccepted.json();
    let nearStatus;
    for (let i = 0; i < 250; i++) {
      nearStatus = await (await fetch(`${base}/api/videos/${nearId}`)).json();
      if (["ready", "error"].includes(nearStatus.phase)) break;
      await sleep(100);
    }
    assert.equal(nearStatus.phase, "ready", JSON.stringify(nearStatus));
    assert.ok(nearStatus.video.duration > 59 && nearStatus.video.duration <= 60);
    assert.ok(nearStatus.video.frames.at(-1).timestamp > 58);

    const badForm = new FormData();
    badForm.set("video", new File(["invalid"], "notes.txt", { type: "text/plain" }));
    assert.equal((await fetch(`${base}/api/videos/analyze`, { method: "POST", body: badForm })).status, 400);
    const corruptForm = new FormData();
    corruptForm.set("video", new File(["invalid"], "corrupt.mp4", { type: "video/mp4" }));
    const corruptAccepted = await fetch(`${base}/api/videos/analyze`, { method: "POST", body: corruptForm });
    assert.equal(corruptAccepted.status, 202);
    const { id: corruptId } = await corruptAccepted.json();
    let corruptStatus;
    for (let i = 0; i < 60; i++) {
      corruptStatus = await (await fetch(`${base}/api/videos/${corruptId}`)).json();
      if (["ready", "error"].includes(corruptStatus.phase)) break;
      await sleep(100);
    }
    assert.equal(corruptStatus.phase, "error");
    assert.ok(corruptStatus.error);
  } finally {
    app.kill();
    await new Promise(resolve => mock.close(resolve));
    await rm(work, { recursive: true, force: true });
  }
});
