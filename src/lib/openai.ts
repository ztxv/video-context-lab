import { readFile } from "node:fs/promises";
import type { TranscriptSegment, VideoContext } from "./types";
import { frameDataUrl, nearbySpeech, timecode } from "./media";

const API = () => process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";
const ANALYSIS_MODEL = () => process.env.OPENAI_ANALYSIS_MODEL || "gpt-6-astra";
const TRANSCRIPTION_MODEL = () => process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";

function key(): string {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("Set OPENAI_API_KEY in .env.local to enable transcription and video analysis.");
  return process.env.OPENAI_API_KEY.trim();
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) }); }
  catch { throw new Error("Could not reach the OpenAI API. Check your connection and try again."); }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = data.error as { message?: string } | undefined;
    throw new Error(`OpenAI request failed (${response.status}): ${error?.message || response.statusText}`);
  }
  return data;
}

export async function transcribe(audioPath: string): Promise<{ fullText: string; segments: TranscriptSegment[] }> {
  const form = new FormData();
  form.set("file", new File([await readFile(audioPath)], "audio.mp3", { type: "audio/mpeg" }));
  const model = TRANSCRIPTION_MODEL();
  form.set("model", model);
  if (model === "whisper-1") {
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  }
  const data = await request(`${API()}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form });
  const segments = Array.isArray(data.segments) ? data.segments.flatMap(raw => {
    const segment = raw as Record<string, unknown>;
    return typeof segment.text === "string" && typeof segment.start === "number" && typeof segment.end === "number"
      ? [{ start: segment.start, end: segment.end, text: segment.text.trim() }] : [];
  }) : [];
  return { fullText: typeof data.text === "string" ? data.text.trim() : "", segments };
}

const instructions = `You analyze short videos as evidence for a curious builder. Use both the transcript and visible frames when available. Treat a narrator's implementation claims as reported speech unless visuals confirm them. Describe visible details that speech omits. Refer to timestamps in MM:SS format. Distinguish direct observation, plausible inference, and what cannot be determined without forcing labels into every reply. Do not invent frameworks, source code, or unreadable on-screen text. For technical demonstrations, explain likely implementation paths and hard parts. If there is no speech, use the visuals. Be concise but useful. The video timeline supplied in the first user message is authoritative for this conversation.`;

type Content = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" };

async function response(input: { role: "user"; content: Content[] }[], previousResponseId?: string) {
  const body: Record<string, unknown> = { model: ANALYSIS_MODEL(), instructions, input, store: true };
  if (previousResponseId) body.previous_response_id = previousResponseId;
  const data = await request(`${API()}/responses`, { method: "POST", headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const output = data.output as { type?: string; content?: { type?: string; text?: string }[] }[] | undefined;
  const text = typeof data.output_text === "string" ? data.output_text : output?.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n") || "";
  if (!text.trim() || typeof data.id !== "string") throw new Error("OpenAI returned an empty analysis. Please try again.");
  return { text: text.trim(), responseId: data.id };
}

export async function analyze(context: VideoContext) {
  const transcript = context.transcript.segments.length
    ? context.transcript.segments.map(s => `[${timecode(s.start)}–${timecode(s.end)}] ${s.text}`).join("\n")
    : context.transcript.fullText || "(No speech detected.)";
  const content: Content[] = [{ type: "input_text", text: `Analyze this ${timecode(context.duration)} uploaded video (${context.width}×${context.height}, container ${context.format}). Complete transcript follows:\n${transcript}\n\nThe next images are frames in timeline order. Each frame's timestamp and nearby speech are given immediately before it. Read visible UI and text where possible.` }];
  for (const frame of context.frames) {
    content.push({ type: "input_text", text: `[${timecode(frame.timestamp)}] Selected by ${frame.reason}. Nearby speech: ${nearbySpeech(context.transcript.segments, frame.timestamp) || "(none or unavailable)"}` });
    content.push({ type: "input_image", image_url: await frameDataUrl(frame.path), detail: "auto" });
  }
  content.push({ type: "input_text", text: `Use exactly these Markdown H2 headings: ## What the video shows; ## Timeline; ## Technical interpretation; ## Reverse engineering; ## Observed vs inferred; ## Recreation path. Cite timestamps for moments you describe. Explain uncertainty plainly. Treat ideas for recreating the concept as original implementations. Use bullets rather than tables.` });
  return response([{ role: "user", content }]);
}

export async function ask(question: string, previousResponseId: string) {
  return response([{ role: "user", content: [{ type: "input_text", text: question }] }], previousResponseId);
}
