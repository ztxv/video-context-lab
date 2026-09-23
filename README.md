# Video Context Lab

Video Context Lab is a local-first Next.js application for interrogating short videos. Upload a developer demo or another short clip, receive a timestamped analysis grounded in speech and selected video frames, and ask follow-up questions about the same video.

The project is deliberately scoped as a single-user MVP. It is useful for exploring a video, understanding a product demo, and turning an observed interaction into an original implementation plan.

## Features

- Upload MP4, MOV, and WebM files up to 60 seconds and 250 MB.
- Inspect duration, dimensions, detected format, audio presence, and selected keyframes.
- Transcribe speech with segment timestamps when an audio track contains speech.
- Analyze visible UI, on-screen text, motion, and transcript context with OpenAI.
- Browse an overview, timeline, transcript, extracted evidence, and reverse-engineering view.
- Click timestamps to seek the browser player.
- Ask follow-up questions without sending the video through transcription again.
- Stream converted playback media with HTTP range support.

## Requirements

- Node.js 22.13 or newer
- npm
- FFmpeg and ffprobe available on `PATH`
- An OpenAI API key with access to the configured analysis and transcription models

On Windows, install FFmpeg through a package manager such as `winget`, or download a build and set `FFMPEG_PATH` and `FFPROBE_PATH` in `.env.local`. Verify the tools before starting the app:

```powershell
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## Local development

From the project directory:

```powershell
npm install
Copy-Item .env.example .env.local
```

Open `.env.local` and set `OPENAI_API_KEY`. Do not put a real key in `.env.example`, source code, a commit, or a public issue.

Start the development server:

```powershell
npm run dev
```

Open <http://localhost:3000> and upload a short clip. The server keeps temporary files under `work/processing` by default. That directory is ignored by Git.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes | None | Server-side OpenAI credential. |
| `OPENAI_ANALYSIS_MODEL` | No | `gpt-6-astra` | Model used for visual and transcript analysis. |
| `OPENAI_TRANSCRIPTION_MODEL` | No | `whisper-1` | Model used for speech transcription. `whisper-1` is used by default because segment timestamps are requested for it. |
| `FFMPEG_PATH` | No | `ffmpeg` | FFmpeg executable path. |
| `FFPROBE_PATH` | No | `ffprobe` | ffprobe executable path. |
| `VIDEO_TEMP_DIR` | No | `work/processing` | Directory for uploaded videos, frames, and playback copies. |
| `OPENAI_API_BASE_URL` | No | OpenAI API | Optional API base URL, primarily useful for integration tests and compatible local proxies. |

The committed `.env.example` contains safe placeholders only. `.env.local`, `.env.production`, and all other `.env*` files are ignored.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Create a production build. |
| `npm start` | Serve the production build. Run `npm run build` first. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm test` | Run unit tests for media selection, formatting, and validation. |
| `npm run test:integration` | Run the local integration suite after a production build. Uses generated media and a mock OpenAI API, so it makes no paid API calls. |

Recommended pre-publish check:

```powershell
npm run typecheck
npm test
npm run build
npm run test:integration
```

The integration test requires FFmpeg and ffprobe. It generates audio, silent portrait, near-limit, invalid, and corrupt test videos under the ignored `work/integration` directory.

## Architecture

The application uses the Next.js App Router and a Node.js runtime for video processing.

1. `POST /api/videos/analyze` validates the extension and 250 MB size limit, stores the upload, and creates an in-memory job.
2. The processing engine reads metadata with ffprobe, prepares browser playback, extracts audio, and skips transcription for silent videos.
3. Scene changes and spaced timestamps are used to select up to 16 frames. The complete transcript and timestamped frame evidence are sent to the OpenAI Responses API.
4. `GET /api/videos/{id}` reports progress and returns the finished analysis.
5. `GET /api/videos/{id}/media` serves browser-compatible media with range requests. `GET /api/videos/{id}/frames/{index}` serves the exact JPEG evidence used for analysis.
6. `POST /api/videos/{id}/chat` continues the stored OpenAI Responses conversation using `previous_response_id`, so follow-up questions do not reprocess the video.

The main implementation areas are:

- `src/app/page.tsx`: upload workflow and analysis workspace.
- `src/app/api/videos`: upload, status, media, frame, and chat routes.
- `src/lib/engine.ts`: processing pipeline and job phases.
- `src/lib/media.ts`: ffmpeg/ffprobe execution, scene detection, frame selection, and playback conversion.
- `src/lib/openai.ts`: transcription, multimodal analysis, and follow-up requests.
- `src/lib/sessions.ts`: in-memory session lifecycle and cleanup.
- `src/lib/presentation.ts`: analysis formatting and timestamp presentation.

## Data retention and privacy

This version has no accounts, database, authentication, cloud storage, or multi-user isolation. Uploads and derived media stay on the machine running the app for up to two hours. The extracted audio file is deleted after processing. Sessions are held in memory and disappear when the server restarts.

The server sends the audio transcript, selected frame images, and related video metadata to the configured OpenAI API. The API key is used only by server routes and is never exposed to the browser. Review your OpenAI account settings and applicable data-handling requirements before uploading sensitive material.

Do not expose this MVP directly to the public internet without adding authentication, rate limiting, request-size controls at the proxy, per-user isolation, durable job storage, and a deliberate media retention policy.

## Publishing to GitHub

The directory currently contains the application files but may not yet be a Git repository. Run these commands from the project directory in PowerShell:

```powershell
git init
git add .
git status
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/video-context-lab.git
git push -u origin main
```

Before the first `git add`, confirm that `git status` does not list `.env.local`, `node_modules`, `.next`, or `work`. The `.gitignore` excludes them, while `.env.example` is intentionally tracked.

Create the empty GitHub repository first at <https://github.com/new>. Use the same repository name as the remote URL, leave README, `.gitignore`, and license generation unchecked, and then run the commands above. If the remote already exists, inspect it before replacing it:

```powershell
git remote -v
git remote set-url origin https://github.com/YOUR_USERNAME/video-context-lab.git
```

For SSH instead of HTTPS:

```powershell
git remote add origin git@github.com:YOUR_USERNAME/video-context-lab.git
```

If a secret was ever committed, removing the file in a later commit is not enough. Rotate the key immediately, remove it from Git history with a history-rewrite tool, and force-push only after coordinating with anyone else using the repository.

## Production publishing

`npm run build` and `npm start` are the production commands:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

This app is not a drop-in serverless deployment. It requires all of the following at runtime:

- A persistent Node.js process for in-memory job polling and follow-up chat.
- FFmpeg and ffprobe installed on the host.
- Writable local disk for uploads and generated frames.
- Enough request and execution time for 250 MB uploads and video conversion.
- A persistent or otherwise deliberately managed `VIDEO_TEMP_DIR`.

A small VPS, dedicated VM, or container host with a mounted writable volume is a better fit for the current implementation than an ephemeral serverless function. Put a reverse proxy in front of it, terminate HTTPS there, set the environment variables in the host secret manager, and configure upload/request timeouts above the expected processing time.

Platforms with ephemeral filesystems, short function timeouts, or multiple independently scaled instances will require architectural changes first. A production version should move jobs to a queue, sessions to durable storage, media to object storage, and add authentication and quotas. Do not assume a single local `work/processing` directory will be shared between replicas.

## Known limitations

- Single-user, in-memory session storage; all sessions disappear after a restart.
- No authentication, authorization, rate limiting, or usage quotas.
- Uploads are buffered in memory by the upload route.
- Analysis is limited to 60 seconds and 250 MB.
- Some codecs require extra time and disk space for H.264/AAC playback conversion.
- Keyframe sampling can miss brief text, subtle motion, or events between selected frames.
- Visual analysis can describe what is visible but cannot recover hidden source code or prove a framework choice.
- OpenAI requests require network access and may incur usage charges outside the integration tests.
- Future X downloading and browser-extension ingestion are not implemented.

## API reference

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/videos/analyze` | Accept a `video` multipart upload and return `{ id }` with HTTP 202. |
| `GET` | `/api/videos/{id}` | Return job phase, errors, metadata, transcript, frames, analysis, and chat history. |
| `GET` | `/api/videos/{id}/media` | Stream browser playback media, including byte ranges. |
| `GET` | `/api/videos/{id}/frames/{index}` | Return one selected analysis frame as JPEG. |
| `POST` | `/api/videos/{id}/chat` | Accept `{ "question": "..." }` and return a contextual answer. |

## Contributing

Keep changes focused, run the full pre-publish check, and do not commit secrets or generated media. When changing the processing pipeline, update the unit or integration coverage for the affected behavior. Preserve the distinction between directly observed video evidence, reported speech, and model inference in user-facing analysis.

## References

- [OpenAI speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI image input guide](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state)
- [Next.js documentation](https://nextjs.org/docs)
