# Motion Studio

**Live app:** [https://motion-studio-bablush.readychar256.chatgpt.site](https://motion-studio-bablush.readychar256.chatgpt.site)

Open the live app with the same ChatGPT account that owns this Site. The hosted web app uses browser templates and browser rendering; the local app additionally supports Ollama AI.

A web app that runs on your laptop and turns a prompt or script into an editable motion graphics video. Ollama plans scenes locally; Remotion animates the scenes and exports an MP4. No API key is needed.

## Windows: first run

1. Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org/). Choose the LTS installer and keep its default options. Close and reopen your terminal after installing.
2. Install **Ollama for Windows** from [ollama.com/download/windows](https://ollama.com/download/windows), then open PowerShell and download the default model:

   ```powershell
   ollama pull qwen2.5:3b
   ```

3. Extract this app into a folder you can write to, such as `Documents\MotionStudio`. Do not run it inside the ZIP.
4. Double-click **`start-windows.cmd`**. On the first run it installs dependencies, downloads Remotion's rendering browser, and builds the app. This needs internet and can take several minutes. It does not need an administrator terminal.
5. Your browser opens **http://localhost:3001**. Keep the launcher window open while using the app. Press `Ctrl+C` in that window to stop it.

Ollama should be running in the Windows system tray. If the app cannot connect, run `ollama serve` in a separate terminal. If that command says the port is already in use, Ollama is already running. The app's template mode works without Ollama, including MP4 exports after the initial dependencies and rendering browser have been installed.

### Run commands yourself

Open PowerShell in the extracted app folder:

```powershell
npm install
npm run setup
npm run build
npm start
```

Then visit **http://localhost:3001**. For later starts, only `npm start` is required. Run `npm run build` again after changing the source code.

## Create your first video

1. Describe your idea in the prompt. For example: “Create a 30-second launch video for an online course. Use bold orange typography, three benefits, and a final invitation to join.”
2. Optionally paste your spoken script. You can also upload a voiceover, background audio, or narrator video.
3. Choose Ollama for local AI planning, or use template mode. Generate the scenes.
4. Review the preview and edit the scene wording, scene type, and duration. Choose a color theme and landscape, portrait, or square format.
5. Adjust the audio and narrator settings, then export and download the MP4.

The scene planner writes titles, key points, and suggested narration. **Suggested narration is text:** this app does not generate a voice. Upload a recorded voiceover or narrator video to hear speech in the exported video.

## What the app creates

- Animated title cards, kinetic typography, big numbers, key points, quotes, and closing cards.
- An interactive preview and a real MP4 render on your laptop, in 720p or 1080p export quality.
- Landscape `1920 × 1080`, portrait `1080 × 1920`, and square `1080 × 1080` projects.
- Uploaded audio with adjustable volume, and an optional narrator video inset with its own audio and volume.
- Editable scene timing, text, themes, and saved project JSON. Projects can be 5–120 seconds long, with up to 12 scenes.

Ollama turns your request into a structured plan for these motion graphics templates. It does not synthesize arbitrary filmed footage, invent new animation code, or provide a general video editor. Audio and video uploads are **not automatically transcribed**: paste the transcript or script when you want the graphics to follow the spoken content. Timing is adjusted by scene; there is no automatic lip synchronization, word-level transcription, or generated text-to-speech.

## Save and reopen a project

Use the app's save action to download the project as a JSON file, then use its load action to reopen that JSON later. A project stores its scene plan, settings, and references to uploaded media; it does **not** embed the media files.

Uploaded media lives in `data/uploads/`, its index is `data/uploads.json`, and rendered videos live in `data/exports/`. Keep the app folder and the entire `data/` directory together if you move to another laptop. A JSON file by itself is enough for a project with no uploaded media. If referenced files are missing, re-upload the media. Back up project JSON and any media you want to keep.

Uploads are limited to 200 MB per file. Supported audio extensions are MP3, WAV, M4A, AAC, OGG, and FLAC; narrator video accepts MP4 and WebM. Whether an individual file plays also depends on its codec. H.264 MP4 video and MP3/WAV audio are good starting choices.

## Local model and configuration

The default model is **`qwen2.5:3b`**, a small starting point for Windows laptops. A larger model can produce better scene plans but uses more RAM and takes longer. Install any suitable Ollama text model with `ollama pull MODEL_NAME` and select an installed model in the app.

Copy `.env.example` to `.env` if you want to change the defaults:

```dotenv
PORT=3001
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

Leave `CHROME_EXECUTABLE` unset to use the browser installed by `npm run setup`. If you already have a compatible Chrome/Chromium executable, set its full path in `.env`. For example:

```dotenv
CHROME_EXECUTABLE="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

With that setting, setup skips the browser download. Rendering with a current installed Chrome may work, but Remotion's downloaded Chrome Headless Shell is the default tested choice.

Your prompts, uploads, and renders stay on your laptop. The app accepts a local Ollama endpoint; use `OLLAMA_BASE_URL` if your local Ollama runs on a different port. Initial installation downloads Node dependencies, a browser, and your selected Ollama model.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| “Node.js was not found” | Install Node.js 22 or newer, close the terminal, then rerun the launcher. |
| Ollama is unavailable | Check that Ollama is running. Try `ollama list` and `ollama serve`. Confirm `OLLAMA_BASE_URL` in `.env`. |
| Model is missing | Run `ollama pull qwen2.5:3b`, or select a model shown by `ollama list`. |
| Planning is slow or runs out of memory | Close other large apps, use the 3B default model, or switch to template mode. More RAM helps; a GPU is optional. |
| Export is slow | Rendering uses CPU and memory. Try a shorter video and close other heavy apps. Wait for the export progress to finish. |
| Rendering browser is missing | Run `npm run setup` with internet access. If using `CHROME_EXECUTABLE`, check that the file exists. |
| Export has no speech | Suggested narration is text. Upload a recorded voiceover or a narrator video with an audio track, and check volume settings. |
| Audio does not match the graphics | Paste the transcript and adjust individual scene durations. Uploaded audio is not analyzed automatically. |
| A media upload or export fails | Try a common browser-supported format such as MP3/WAV audio or H.264 MP4 video; check available disk space. |
| Port 3001 is already in use | Stop the other app, or set `PORT` to another port in `.env` and open the address printed in the terminal. |

## macOS and Linux

Install Node.js 22 or newer and [Ollama](https://ollama.com/download), open a terminal in the app folder, and run:

```bash
ollama pull qwen2.5:3b
npm install
npm run setup
npm run build
npm start
```

Linux may need additional system libraries for Chrome Headless Shell. See [Remotion's Linux dependencies](https://www.remotion.dev/docs/miscellaneous/linux-dependencies) if browser startup reports missing libraries.

## Development

```bash
npm run dev
```

The React/Vite app runs at **http://127.0.0.1:5173**, and the Express API runs on port **3001** by default. `npm run build` checks TypeScript and creates `dist/`; `npm start` serves the built app and API together. `npm run check` checks TypeScript, and `npm test` runs the server tests.

The app uses React and a Remotion Player for preview, an Express server for uploads and Ollama requests, and Remotion's local renderer for MP4 export. All Remotion packages are pinned to the same version.

## License

This app's original source code is provided under the MIT license in `LICENSE`. Dependencies have their own licenses. Remotion has licensing terms that depend on your organization and use; review [Remotion's license](https://www.remotion.dev/license) before commercial or organizational use.

## Open the hosted web app

The browser build runs from a hosted HTTPS link without Node.js, Ollama, or a localhost server. Open it in current Chrome or Edge for video export. It uses the built-in prompt/script planner and motion templates; Ollama AI remains available in the downloaded local app.

Audio and narrator files are kept in this browser’s IndexedDB storage. They are not uploaded to the hosting server. Save a project JSON backup and keep the original media: a different browser or device needs its own media upload. Clearing site storage removes these media files. Download finished exports before leaving the page; the encoded video is held in memory until then.

Browser export includes motion graphics, your audio, and the narrator inset. It selects MP4 H.264/AAC when the browser supports it, with a clearly labelled WebM fallback. Keep the tab open while exporting. Long videos and larger media need more memory and may take longer. Automatic transcription, generated voices, and cloud AI generation are not included.

To build the standalone hosted version:

```bash
npm ci
npm run build:web
```

Host the contents of `dist/` on an HTTPS static host. This build does not need the Express API. The normal `npm run build` + `npm start` workflow retains local Ollama generation and the native MP4 renderer.
