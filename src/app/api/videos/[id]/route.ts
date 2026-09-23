import { getJob } from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Session expired or was not found." }, { status: 404 });
  const context = job.context;
  return Response.json({
    id: job.id,
    phase: job.phase,
    error: job.error,
    video: context ? {
      filename: context.filename, duration: context.duration, width: context.width, height: context.height,
      format: context.format, hasAudio: context.hasAudio,
      transcript: context.transcript, frames: context.frames.map((frame, index) => ({ timestamp: frame.timestamp, reason: frame.reason, imageUrl: job.phase === "ready" ? `/api/videos/${id}/frames/${index}` : undefined })),
      analysis: context.analysis,
      mediaUrl: job.phase === "ready" ? `/api/videos/${id}/media` : undefined,
    } : undefined,
    history: job.history,
  }, { headers: { "Cache-Control": "no-store" } });
}
