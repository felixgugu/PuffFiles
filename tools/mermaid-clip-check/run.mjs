/**
 * 用 headless Chrome 跑實驗場，把 `<pre id="report">` 的內容抓回來（暫時的開發工具）。
 *
 * 用法：node tools/mermaid-clip-check/run.mjs [url]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:1420/tools/mermaid-clip-check/index.html";
const shotPath = process.argv[3] ?? null;
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "puff-mermaid-check-"));

const child = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    shotPath ? "--screenshot=" + shotPath : "--dump-dom",
    "--window-size=800,900",
    "--virtual-time-budget=120000",
    `--user-data-dir=${profile}`,
    url,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let dom = "";
let err = "";
child.stdout.on("data", (chunk) => (dom += chunk));
child.stderr.on("data", (chunk) => (err += chunk));

child.on("close", (code) => {
  const match = /<pre id="report">([\s\S]*?)<\/pre>/.exec(dom);
  if (!match) {
    console.log(`沒有拿到 report（chrome exit ${code}）`);
    console.log(dom.slice(0, 2000));
    console.log(err.slice(0, 2000));
    process.exit(1);
  }
  const text = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  console.log(text);
});
