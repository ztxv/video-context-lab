import { ask } from "@/lib/openai";
import { getJob } from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Session expired or was not found." }, { status: 404 });
  if (job.phase !== "ready" || !job.responseId) return Response.json({ error: "Video analysis is not ready yet." }, { status: 409 });
  if (job.chatting) return Response.json({ error: "Please wait for the current answer." }, { status: 409 });
  let question: unknown;
  try { question = (await request.json()).question; }
  catch { return Response.json({ error: "Send a question as JSON." }, { status: 400 }); }
  if (typeof question !== "string" || !question.trim() || question.length > 4000) return Response.json({ error: "Enter a question of up to 4,000 characters." }, { status: 400 });
  job.chatting = true;
  try {
    const result = await ask(question.trim(), job.responseId);
    job.responseId = result.responseId;
    job.history.push({ question: question.trim(), answer: result.text });
    return Response.json({ answer: result.text });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not answer this question." }, { status: 502 });
  } finally {
    job.chatting = false;
  }
}
