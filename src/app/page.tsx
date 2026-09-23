"use client";

import { useEffect, useRef, useState } from "react";
import { formatTimestamp, parseAnalysis } from "@/lib/presentation";
import { RichText } from "./rich-text";

type Phase = "uploading" | "reading" | "preparing_playback" | "extracting_audio" | "transcribing" | "analyzing_scenes" | "selecting_keyframes" | "understanding" | "ready" | "error";
type Tab = "overview" | "timeline" | "reverse" | "transcript" | "context" | "chat";
type Segment = { start: number; end: number; text: string };
type Frame = { timestamp: number; reason: string; imageUrl?: string };
type Video = {
  filename: string; duration: number; width: number; height: number; format: string; hasAudio: boolean;
  transcript: { fullText: string; segments: Segment[] }; frames: Frame[]; analysis?: string; mediaUrl?: string;
};
type Session = { id: string; phase: Phase; error?: string; video?: Video; history: { question: string; answer: string }[] };

const labels: Record<Phase, string> = {
  uploading: "Uploading video…", reading: "Reading video…", preparing_playback: "Preparing playback…", extracting_audio: "Extracting audio…", transcribing: "Transcribing speech…",
  analyzing_scenes: "Analyzing scenes…", selecting_keyframes: "Selecting keyframes…", understanding: "Understanding video…", ready: "Ready", error: "Something went wrong",
};
const phases: Phase[] = ["uploading", "reading", "preparing_playback", "extracting_audio", "transcribing", "analyzing_scenes", "selecting_keyframes", "understanding", "ready"];
const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "timeline", label: "Timeline" }, { id: "reverse", label: "Reverse Engineer" },
  { id: "transcript", label: "Transcript" }, { id: "context", label: "Context" }, { id: "chat", label: "Chat" },
];
const prompts = ["Explain this", "How was this built?", "Help me recreate the concept", "What's happening here?"];
const reversePrompt = "Reverse engineer this video. Explain what was built, what is directly observed versus reported or inferred, the probable architecture, possible technologies without claiming certainty, an implementation approach, difficult components, unknowns, an original version I could build, and a small MVP scope. Use headings and bullets instead of a table. Cite relevant moments.";

function TranscriptRows({ video, seek }: { video: Video; seek: (seconds: number) => void }) {
  if (!video.transcript.segments.length) return <p className="empty-note">{video.transcript.fullText || (video.hasAudio ? "Audio was detected, but no speech was transcribed." : "This video has no audio track.")}</p>;
  return <div className="transcript-list">{video.transcript.segments.map((segment, index) => <div className="transcript-row" key={index}>
    <button type="button" className="segment-time" onClick={() => seek(segment.start)}>{formatTimestamp(segment.start, true)}<span>–</span>{formatTimestamp(segment.end, true)}</button>
    <p>{segment.text}</p>
  </div>)}</div>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) void refresh(id);
  }, []);

  useEffect(() => {
    if (!session || session.phase === "ready" || session.phase === "error") return;
    const timer = setInterval(() => { void refresh(session.id); }, 1200);
    return () => clearInterval(timer);
  }, [session]);

  async function refresh(id: string) {
    try {
      const response = await fetch(`/api/videos/${id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load this session.");
      setSession(data);
      setPhase(data.phase);
      if (data.phase === "error") setError(data.error || "Video processing failed.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load this session.";
      setError(message); setPhase("error");
      setSession({ id, phase: "error", error: message, history: [] });
    }
  }

  function upload(file: File) {
    setError(""); setSession(null); setChatError(""); setPhase("uploading"); setUploadPercent(0); setActiveTab("overview");
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["mp4", "mov", "webm"].includes(extension || "")) { setError("Choose an MP4, MOV, or WebM video."); setPhase("error"); return; }
    if (file.size > 250 * 1024 * 1024) { setError("The file is too large. Limit: 250 MB."); setPhase("error"); return; }
    const form = new FormData(); form.set("video", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos/analyze");
    xhr.upload.onprogress = event => { if (event.lengthComputable) setUploadPercent(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      let data: { id?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 202 || !data.id) { setError(data.error || "Upload failed."); setPhase("error"); return; }
      history.replaceState(null, "", `#${data.id}`);
      setSession({ id: data.id, phase: "reading", history: [] });
      setPhase("reading");
      void refresh(data.id);
    };
    xhr.onerror = () => { setError("Upload failed. Check your connection and try again."); setPhase("error"); };
    xhr.send(form);
  }

  async function sendQuestion(value = question, target: Tab = "chat") {
    if (!session || !value.trim() || asking) return;
    setAsking(true); setChatError(""); setQuestion(""); setActiveTab(target);
    try {
      const response = await fetch(`/api/videos/${session.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: value.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not answer this question.");
      setSession(previous => previous ? { ...previous, history: [...previous.history, { question: value.trim(), answer: data.answer }] } : previous);
    } catch (err) { if (target === "chat") setQuestion(value); setChatError(err instanceof Error ? err.message : "Could not answer this question."); }
    finally { setAsking(false); }
  }

  function seek(seconds: number) {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = Math.min(seconds, session?.video?.duration || seconds);
    void player.play().catch(() => {});
    player.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function reset() {
    history.replaceState(null, "", location.pathname);
    setSession(null); setPhase(null); setError(""); setQuestion(""); setChatError(""); setActiveTab("overview");
    if (inputRef.current) inputRef.current.value = "";
  }

  const video = session?.video;
  const ready = session?.phase === "ready" && !!video?.analysis;
  const sections = parseAnalysis(video?.analysis || "");
  const reverseAnswer = session?.history.filter(item => item.question === reversePrompt).at(-1)?.answer;
  const extension = video?.filename.split(".").pop()?.toUpperCase() || "VIDEO";

  return <main className={`shell ${session ? "has-video" : ""}`}>
    <header className="site-header"><div className="wordmark">VIDEO CONTEXT <span>LAB</span></div><div className="header-note">Short video, deeper understanding</div></header>
    {!session && <section className="intro"><div className="eyebrow">VIDEO UNDERSTANDING WORKSPACE</div><h1>Understand what you&apos;re watching.<br /><span>Then figure out how it works.</span></h1><p>Upload a short demo, inspect its moments, and ask questions grounded in what appears and what is said.</p></section>}
    {!session && <section className="upload-panel"><div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { event.preventDefault(); setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) upload(file); }}>
      <div className="upload-icon">↥</div><h2>Analyze a short video</h2><p>Drop your MP4, MOV, or WebM here</p><div className="or">or</div><button type="button" className="primary-button" onClick={() => inputRef.current?.click()}>Choose video <span>↗</span></button><input ref={inputRef} type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" hidden onChange={event => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /><div className="upload-limit">MAX 60 SECONDS · MAX 250 MB</div>
    </div>{phase === "uploading" && <p className="status-message">Uploading video… {uploadPercent}%</p>}{error && <div role="alert" className="error-box">{error}</div>}</section>}
    {session && <div className="workspace">
      <div className="workspace-top"><div className="file-heading"><div className="eyebrow">CURRENT VIDEO</div><h1>{video?.filename || "Preparing video…"}</h1>{video && <p>{formatTimestamp(video.duration)} <span>•</span> {video.width} × {video.height} <span>•</span> {extension}</p>}</div><div className="top-actions"><button type="button" className="action-button" onClick={() => void sendQuestion(reversePrompt, "reverse")} disabled={!ready || asking}>Reverse engineer this ↗</button><button type="button" className="text-button" onClick={reset}>+ New video</button></div></div>
      {session.phase !== "ready" && session.phase !== "error" && <div className="processing-card"><div className="spinner" /><div className="processing-copy"><h2>{labels[session.phase]}</h2><p>Building a timestamped view of what appears and what is said.</p></div><div className="step-list">{phases.slice(1, -1).map(step => <span key={step} className={phases.indexOf(step) <= phases.indexOf(session.phase) ? "active" : ""}>{labels[step].replace("…", "")}</span>)}</div></div>}
      {session.phase === "error" && <div className="error-box" role="alert"><strong>Could not analyze this video.</strong><p>{session.error || error}</p><button type="button" className="text-button" onClick={reset}>Try another video</button></div>}
      {ready && video && <div className="workspace-grid">
        <aside className="video-column"><div className="player-card"><div className="player-stage"><video ref={playerRef} className={video.height > video.width ? "portrait" : "landscape"} src={video.mediaUrl} controls playsInline preload="metadata" /></div><div className="player-meta"><span>{formatTimestamp(video.duration)} duration</span><span>{video.width} × {video.height}</span><span>{extension}</span></div></div><div className="moments-card"><div className="card-title"><h2>Key moments</h2><span>{video.frames.length}</span></div><p>Click a timestamp to jump to the clip.</p><div className="moment-list">{video.frames.map((frame, index) => <button type="button" key={index} onClick={() => seek(frame.timestamp)}><strong>{formatTimestamp(frame.timestamp, true)}</strong><span>{frame.reason}</span><span aria-hidden>↗</span></button>)}</div></div></aside>
        <div className="content-column"><nav className="workspace-tabs" role="tablist" aria-label="Video analysis views">{tabs.map(tab => <button type="button" key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "selected" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}{tab.id === "chat" && !!session.history.length && <span className="tab-count">{session.history.length}</span>}</button>)}</nav>
          <section className="workspace-panel" role="tabpanel">
            {activeTab === "overview" && <><div className="panel-heading"><div><div className="section-label">INITIAL ANALYSIS</div><h2>Overview</h2></div></div><div className="analysis-section"><RichText text={sections.overview || video.analysis || ""} duration={video.duration} seek={seek} /></div>{sections.technical && <div className="analysis-section"><h3>Technical interpretation</h3><RichText text={sections.technical} duration={video.duration} seek={seek} /></div>}{sections.evidence && <div className="analysis-section"><h3>Observed vs inferred</h3><RichText text={sections.evidence} duration={video.duration} seek={seek} /></div>}{sections.recreation && <div className="analysis-section"><h3>Recreation path</h3><RichText text={sections.recreation} duration={video.duration} seek={seek} /></div>}</>}
            {activeTab === "timeline" && <><div className="panel-heading"><div><div className="section-label">SEQUENCE</div><h2>Timeline</h2></div></div><RichText text={sections.timeline || "The model did not provide a separate timeline. Use the key moments beside the player to inspect the clip."} duration={video.duration} seek={seek} /><div className="timeline-points">{video.frames.map((frame, index) => <button type="button" key={index} onClick={() => seek(frame.timestamp)}><span>{formatTimestamp(frame.timestamp, true)}</span>{frame.reason}</button>)}</div></>}
            {activeTab === "reverse" && <><div className="panel-heading"><div><div className="section-label">BUILD FROM THE IDEA</div><h2>Reverse Engineer</h2></div><button type="button" className="small-action" onClick={() => void sendQuestion(reversePrompt, "reverse")} disabled={asking}>{reverseAnswer ? "Run again ↗" : "Reverse engineer this ↗"}</button></div>{sections.reverse && <div className="analysis-section"><h3>Initial technical reading</h3><RichText text={sections.reverse} duration={video.duration} seek={seek} /></div>}{asking && <p className="answering">Reasoning through the implementation…</p>}{reverseAnswer && <div className="reverse-result"><h3>Technical breakdown</h3><RichText text={reverseAnswer} duration={video.duration} seek={seek} /></div>}{!reverseAnswer && !asking && <p className="empty-note">Use the action above for a deeper breakdown of the architecture, likely technologies, hard parts, unknowns, and a small original MVP.</p>}</>}
            {activeTab === "transcript" && <><div className="panel-heading"><div><div className="section-label">WHAT WAS SAID</div><h2>Transcript</h2></div><span className="count-label">{video.transcript.segments.length} segments</span></div><TranscriptRows video={video} seek={seek} /></>}
            {activeTab === "context" && <><div className="panel-heading"><div><div className="section-label">DEVELOPMENT INSPECTOR</div><h2>Extracted context</h2></div></div><p className="inspector-intro">This is the evidence sent to the model. Use it to check transcription, frame coverage, and timing when an answer seems wrong.</p><div className="metadata-grid"><div><span>Original file</span><strong>{video.filename}</strong></div><div><span>Duration</span><strong>{formatTimestamp(video.duration, true)}</strong></div><div><span>Resolution</span><strong>{video.width} × {video.height}</strong></div><div><span>Detected format</span><strong>{video.format}</strong></div><div><span>Audio track</span><strong>{video.hasAudio ? "Detected" : "None"}</strong></div><div><span>Selected frames</span><strong>{video.frames.length}</strong></div></div><div className="inspector-section"><h3>Timestamped transcript</h3><TranscriptRows video={video} seek={seek} /></div><div className="inspector-section"><h3>Frames sent to the model</h3><p className="empty-note">On-screen text is interpreted in the visual analysis. There is no separate OCR pass.</p><div className="frame-grid">{video.frames.map((frame, index) => <div className="frame-card" key={index}><button type="button" className="frame-image-button" onClick={() => seek(frame.timestamp)} title={`Jump to ${formatTimestamp(frame.timestamp, true)}`}>{frame.imageUrl && <img src={frame.imageUrl} alt={`Selected video frame at ${formatTimestamp(frame.timestamp, true)}`} loading="lazy" />}</button><div className="frame-caption"><button type="button" className="segment-time" onClick={() => seek(frame.timestamp)}>{formatTimestamp(frame.timestamp, true)}</button><span>{frame.reason}</span></div></div>)}</div></div></>}
            {activeTab === "chat" && <><div className="panel-heading"><div><div className="section-label">FOLLOW-UP QUESTIONS</div><h2>Ask about this video</h2></div></div>{!session.history.length && <div className="suggestions">{prompts.map(prompt => <button type="button" key={prompt} onClick={() => void sendQuestion(prompt)}>{prompt} ↗</button>)}</div>}{session.history.map((item, index) => <div className="exchange" key={index}><div className="question-bubble">{item.question === reversePrompt ? "Reverse engineer this" : item.question}</div><div className="answer"><RichText text={item.answer} duration={video.duration} seek={seek} /></div></div>)}{asking && <p className="answering">Thinking through the video…</p>}</>}
            {chatError && <div role="alert" className="inline-error">{chatError}</div>}
          </section>
          <form className="chat-composer" onSubmit={event => { event.preventDefault(); void sendQuestion(); }}><label htmlFor="question">ASK ABOUT THIS VIDEO</label><div><input id="question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about a moment, the implementation, or an idea…" maxLength={4000} /><button type="submit" disabled={asking || !question.trim()}>Ask ↗</button></div></form>
        </div>
      </div>}
    </div>}
    <footer>Local uploads only · Sessions expire after two hours</footer>
  </main>;
}
