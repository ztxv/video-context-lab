export type TranscriptSegment = { start: number; end: number; text: string };
export type FrameReason = "opening frame" | "scene change" | "coverage sample" | "final frame";
export type FrameSelection = { timestamp: number; reason: FrameReason };
export type VideoContext = {
  id: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  format: string;
  videoCodec: string;
  audioCodec?: string;
  hasAudio: boolean;
  transcript: { fullText: string; segments: TranscriptSegment[] };
  frames: (FrameSelection & { path: string })[];
  source: { type: string };
  analysis?: string;
};

export type JobPhase =
  | "uploading"
  | "reading"
  | "preparing_playback"
  | "extracting_audio"
  | "transcribing"
  | "analyzing_scenes"
  | "selecting_keyframes"
  | "understanding"
  | "ready"
  | "error";

export type VideoJob = {
  id: string;
  phase: JobPhase;
  error?: string;
  context?: VideoContext;
  responseId?: string;
  dir: string;
  videoPath: string;
  mime: string;
  playbackPath?: string;
  playbackMime?: string;
  createdAt: number;
  history: { question: string; answer: string }[];
  chatting?: boolean;
};
