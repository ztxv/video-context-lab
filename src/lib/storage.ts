import path from "node:path";

export function processingRoot() {
  return process.env.VIDEO_TEMP_DIR || path.join(process.cwd(), "work", "processing");
}
