import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const width = 1280;
const height = 720;
const fps = 30;

interface Slide {
  filename: string;
  eyebrow: string;
  title: string;
  body: readonly string[];
  image?: string;
  imageLayout?: "page" | "zoom";
  duration: number;
}

interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function dataRoot(): string {
  return path.join(os.homedir(), "data", "triage-companion-demo", "token-creation");
}

function latestRunDir(): string {
  const runsDir = path.join(dataRoot(), "runs");
  const runs = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name))
    .sort();
  const latest = runs.at(-1);
  if (!latest) {
    throw new Error(`No token setup runs found under ${runsDir}`);
  }

  return latest;
}

function jonBrowserRoot(): string {
  return process.env.JONBROWSER_REPO ?? path.join(os.homedir(), "repos", "personal", "jonBrowser");
}

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, [...args], { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed`);
  }
}

function shellRun(command: string, cwd: string): void {
  const result = spawnSync("zsh", ["-lc", command], { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(command);
  }
}

function convertPDFToPNG(pdfPath: string, pngPath: string): void {
  run("sips", ["-s", "format", "png", pdfPath, "--out", pngPath], process.cwd());
}

function cropPNG(sourcePath: string, cropPath: string, crop: Crop): void {
  run(
    "sips",
    [
      "-c",
      String(crop.height),
      String(crop.width),
      "--cropOffset",
      String(crop.y),
      String(crop.x),
      sourcePath,
      "--out",
      cropPath,
    ],
    process.cwd(),
  );
}

function htmlEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function writeSlideHTML(slide: Slide, outputDir: string): string {
  const htmlPath = path.join(outputDir, `${slide.filename}.html`);
  const imageHTML = slide.image
    ? `<div class="imageWrap"><img src="${htmlEscape(path.basename(slide.image))}" alt=""></div>`
    : "";
  const bodyHTML = slide.body.map((line) => `<p>${htmlEscape(line)}</p>`).join("\n");
  const imageClass = slide.imageLayout === "zoom" ? " zoomImage" : "";
  const layoutClass = slide.image ? `slide withImage${imageClass}` : "slide textOnly";
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; margin: 0; background: #0b0f19; color: #f6f7fb; font-family: Arial, sans-serif; }
    .slide { width: ${width}px; height: ${height}px; padding: 44px 56px; display: grid; gap: 28px; }
    .withImage { grid-template-columns: 430px 1fr; align-items: center; }
    .zoomImage { grid-template-columns: 390px 1fr; }
    .textOnly { align-content: center; max-width: 920px; }
    .eyebrow { color: #7dd3fc; font-size: 20px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 18px; }
    h1 { font-size: 52px; line-height: 1.02; margin: 0 0 28px; }
    p { color: #d8dee9; font-size: 27px; line-height: 1.34; margin: 0 0 14px; }
    .imageWrap { background: #111827; border: 1px solid #263247; border-radius: 8px; padding: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.35); }
    .zoomImage .imageWrap { padding: 0; overflow: hidden; background: #0d1117; }
    img { display: block; width: 100%; max-height: 604px; object-fit: contain; object-position: top center; }
  </style>
</head>
<body>
  <main class="${layoutClass}">
    <section>
      <div class="eyebrow">${htmlEscape(slide.eyebrow)}</div>
      <h1>${htmlEscape(slide.title)}</h1>
      ${bodyHTML}
    </section>
    ${imageHTML}
  </main>
</body>
</html>
`;
  fs.writeFileSync(htmlPath, html, "utf-8");
  return htmlPath;
}

function renderSlideImage(slide: Slide, outputDir: string, jonBrowserDir: string): string {
  const htmlPath = writeSlideHTML(slide, outputDir);
  const pdfPath = path.join(outputDir, `${slide.filename}.pdf`);
  const pngPath = path.join(outputDir, `${slide.filename}.png`);
  run("swift", ["run", "BrowserCLI", "pdf", htmlPath, pdfPath], jonBrowserDir);
  convertPDFToPNG(pdfPath, pngPath);
  return pngPath;
}

function renderVideoSegment(imagePath: string, segmentPath: string, duration: number): void {
  run(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      String(duration),
      "-i",
      imagePath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      "-r",
      String(fps),
      segmentPath,
    ],
    process.cwd(),
  );
}

function renderGIF(mp4Path: string, gifPath: string, outputDir: string): void {
  const palettePath = path.join(outputDir, "palette.png");
  run(
    "ffmpeg",
    ["-y", "-i", mp4Path, "-vf", "fps=10,scale=960:-1:flags=lanczos,palettegen", palettePath],
    process.cwd(),
  );
  run(
    "ffmpeg",
    ["-y", "-i", mp4Path, "-i", palettePath, "-lavfi", "fps=10,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse", gifPath],
    process.cwd(),
  );
}

function main(): void {
  const runDir = process.argv[2] ? path.resolve(process.argv[2]) : latestRunDir();
  const outputDir = path.join(dataRoot(), "videos", timestamp());
  const jonBrowserDir = jonBrowserRoot();
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });

  const githubRuntime = path.join(outputDir, "github-runtime-token-ready.png");
  const githubSetup = path.join(outputDir, "github-setup-token-ready.png");
  const githubRuntimeSecurity = path.join(outputDir, "github-runtime-security-events.png");
  const githubRuntimeNotifications = path.join(outputDir, "github-runtime-notifications.png");
  const githubSetupPublicRepo = path.join(outputDir, "github-setup-public-repo.png");
  convertPDFToPNG(path.join(runDir, "github-runtime-token-ready.pdf"), githubRuntime);
  convertPDFToPNG(path.join(runDir, "github-setup-token-ready.pdf"), githubSetup);
  cropPNG(githubRuntime, githubRuntimeSecurity, { x: 320, y: 520, width: 900, height: 360 });
  cropPNG(githubRuntime, githubRuntimeNotifications, { x: 320, y: 1080, width: 900, height: 260 });
  cropPNG(githubSetup, githubSetupPublicRepo, { x: 320, y: 520, width: 900, height: 360 });

  const slides: readonly Slide[] = [
    {
      filename: "slide-00-title",
      eyebrow: "Triage Companion",
      title: "Provider token setup pre-demo",
      body: [
        "Browser captures from the throwaway GitHub, Snyk, and Jira accounts.",
        "The screenshots stop before token values are shown.",
        "Token capture writes directly to ~/data/triage-companion-demo/demo.env.",
      ],
      duration: 4,
    },
    {
      filename: "slide-01-github-runtime",
      eyebrow: "GitHub runtime token",
      title: "Classic PAT for the recorded CLI walkthrough",
      body: [
        "Expiration is set to 7 days.",
        "High-level page capture first.",
        "The next slides zoom into the selected scopes.",
      ],
      image: githubRuntime,
      duration: 5,
    },
    {
      filename: "slide-02-github-runtime-security",
      eyebrow: "GitHub runtime token",
      title: "Security alerts scope",
      body: [
        "security_events is selected.",
        "Repository write scopes remain unchecked.",
      ],
      image: githubRuntimeSecurity,
      imageLayout: "zoom",
      duration: 4,
    },
    {
      filename: "slide-03-github-runtime-notifications",
      eyebrow: "GitHub runtime token",
      title: "Notifications scope",
      body: [
        "notifications is selected.",
        "The token remains short-lived.",
      ],
      image: githubRuntimeNotifications,
      imageLayout: "zoom",
      duration: 4,
    },
    {
      filename: "slide-04-github-setup",
      eyebrow: "GitHub setup token",
      title: "Public demo repository setup only",
      body: [
        "Expiration is set to 7 days.",
        "High-level page capture first.",
        "The next slide zooms into the selected scopes.",
      ],
      image: githubSetup,
      duration: 5,
    },
    {
      filename: "slide-05-github-setup-scopes",
      eyebrow: "GitHub setup token",
      title: "Public repo and alerts only",
      body: [
        "public_repo is selected for public demo setup.",
        "security_events is selected for alert configuration.",
        "workflow stays unchecked.",
      ],
      image: githubSetupPublicRepo,
      imageLayout: "zoom",
      duration: 4,
    },
    {
      filename: "slide-06-snyk",
      eyebrow: "Snyk personal access token",
      title: "Demo org token page",
      body: [
        "The setup runner captures the demo account token without printing it.",
        "The account is limited to the demo organization and projects.",
        "No Snyk token-value screenshot is rendered.",
      ],
      duration: 5,
    },
    {
      filename: "slide-07-jira",
      eyebrow: "Jira token setup",
      title: "Scoped Jira tokens after step-up",
      body: [
        "Atlassian requires an email one-time passcode before API token creation.",
        "After verification, the runner creates separate runtime and setup tokens.",
        "The site URL and Cloud ID are discovered automatically.",
      ],
      duration: 6,
    },
    {
      filename: "slide-08-outro",
      eyebrow: "Ready for the terminal recording",
      title: "The env file is ready",
      body: [
        "Generated values are saved in ~/data/triage-companion-demo/demo.env.",
        "The file is mode 0600 and is never stored in the repo.",
        "Then run node demo/record-live-demo.ts to render the live terminal GIF.",
      ],
      duration: 4,
    },
  ];

  const segments: string[] = [];
  for (const [index, slide] of slides.entries()) {
    const slideImage = renderSlideImage(slide, outputDir, jonBrowserDir);
    const segmentPath = path.join(outputDir, `segment-${String(index).padStart(2, "0")}.mp4`);
    renderVideoSegment(slideImage, segmentPath, slide.duration);
    segments.push(segmentPath);
  }

  const concatPath = path.join(outputDir, "concat.txt");
  fs.writeFileSync(
    concatPath,
    segments.map((segment) => `file '${segment.replaceAll("'", "'\\''")}'`).join("\n") + "\n",
    "utf-8",
  );

  const mp4Path = path.join(outputDir, "token-setup-browser-demo.mp4");
  const gifPath = path.join(outputDir, "token-setup-browser-demo.gif");
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", mp4Path], process.cwd());
  renderGIF(mp4Path, gifPath, outputDir);

  shellRun(`ffprobe -hide_banner -v error -show_entries format=duration,size -of default=noprint_wrappers=1 ${JSON.stringify(mp4Path)}`, process.cwd());
  console.log(`Rendered ${mp4Path}`);
  console.log(`Rendered ${gifPath}`);
  console.log(`Source run ${runDir}`);
}

main();
