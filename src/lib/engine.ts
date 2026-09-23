import { rm } from "node:fs/promises";
import { analyze, transcribe } from "./openai";
import { audioIsSilent, detectScenes, extractAudio, extractFrames, inspectVideo, preparePlayback, selectFrames } from "./media";
import type { VideoContext, VideoJob } from "./types";

export async function processVideo(job: VideoJob, filename: string, source: VideoContext["source"]): Promise<void> {
  try {
    job.phase = "reading";
    const metadata = await inspectVideo(job.videoPath);
    const context: VideoContext = job.context = {
      id: job.id, filename, ...metadata,
      transcript: { fullText: "", segments: [] }, frames: [], source,
    };
    job.phase = "preparing_playback";
    const playback = await preparePlayback(job.videoPath, job.dir, job.mime, metadata);
    job.playbackPath = playback.path;
    job.playbackMime = playback.mime;
    let audioPath: string | undefined;
    if (metadata.hasAudio) {
      job.phase = "extracting_audio";
      audioPath = await extractAudio(job.videoPath, job.dir);
      if (!(await audioIsSilent(audioPath))) {
        job.phase = "transcribing";
        context.transcript = await transcribe(audioPath);
      }
    }
    job.phase = "analyzing_scenes";
    const scenes = await detectScenes(job.videoPath);
    job.phase = "selecting_keyframes";
    context.frames = await extractFrames(job.videoPath, job.dir, selectFrames(context.duration, scenes));
    job.phase = "understanding";
    const result = await analyze(context);
    context.analysis = result.text;
    job.responseId = result.responseId;
    job.phase = "ready";
    if (audioPath) await rm(audioPath, { force: true }).catch(() => {});
  } catch (error) {
    job.phase = "error";
    job.error = error instanceof Error ? error.message : "Video processing failed.";
    await rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
}
