/**
 * 用 CDP 驅動「真的應用程式」（瀏覽器 dev 版）驗證 Mermaid 圖表的縮放與拖曳平移
 * （暫時的驗證腳本，跑完就刪）。
 *
 * 用法：node tools/mermaid-clip-check/pan-check.mjs [screenshot.png]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shotPath = process.argv[2] ?? join(tmpdir(), "puff-pan-check.png");
const appUrl = process.env.PUFF_DEV_URL ?? "http://localhost:1420/";
const port = 9334;
const profile = mkdtempSync(join(tmpdir(), "puff-pan-"));

const child = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1400,900",
    "--no-first-run",
    "--no-default-browser-check",
    appUrl,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) {
        return page;
      }
    } catch {
      // DevTools 還沒起來。
    }
    await sleep(500);
  }
  throw new Error("找不到 Chrome 的頁面");
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
};

function send(method, params = {}) {
  const id = (nextId += 1);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const details = response.result?.exceptionDetails;
  if (details) {
    throw new Error(`頁面裡的錯誤：${details.text} ${details.exception?.description ?? ""}`);
  }
  return response.result?.result?.value;
}

await send("Runtime.enable");
await send("Page.enable");

/** 等頁面上的條件成立；`expression` 要回傳 truthy。 */
async function waitFor(expression, label, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`等不到：${label}`);
}

const results = [];
function check(label, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
}

// 1) 開檔案：選取 readme.md（假檔案系統裡就有 mermaid 圖表）再按 Space 開檢視器。
await waitFor("!!document.querySelector('[data-row]')", "檔案清單");
const point = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll("[data-row]"));
  const row = rows.find((item) => item.textContent.includes("readme.md"));
  const box = row.getBoundingClientRect();
  return { x: Math.round(box.left + 120), y: Math.round(box.top + box.height / 2) };
})()`);
for (const type of ["mousePressed", "mouseReleased"]) {
  await send("Input.dispatchMouseEvent", {
    type,
    x: point.x,
    y: point.y,
    button: "left",
    buttons: type === "mousePressed" ? 1 : 0,
    clickCount: 1,
  });
}
for (const type of ["keyDown", "keyUp"]) {
  await send("Input.dispatchKeyEvent", {
    type,
    key: " ",
    code: "Space",
    text: type === "keyDown" ? " " : undefined,
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  });
}
await waitFor("!!document.querySelector('.md-mermaid-view svg[width]')", "圖表渲染", 120);
// 圖表在文件下方，先把它的外殼捲進可視範圍，合成的滑鼠事件才打得到。
await evaluate(
  `document.querySelector(".md-mermaid").scrollIntoView({ block: "center" }); true`,
);
await sleep(400);

// 2) 控制項與初始狀態。
const bar = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const buttons = Array.from(wrapper.querySelectorAll("[data-mermaid-action]"));
  const svg = wrapper.querySelector(".md-mermaid-view svg");
  const view = wrapper.querySelector(".md-mermaid-view");
  const box = svg.getBoundingClientRect();
  const viewBox = view.getBoundingClientRect();
  return {
    order: buttons.map((button) => button.dataset.mermaidAction),
    hidden: buttons.filter((button) => button.hidden).map((button) => button.dataset.mermaidAction),
    readout: wrapper.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
    zoomOutDisabled: wrapper.querySelector('[data-mermaid-action="zoom-out"]').disabled,
    zoomInDisabled: wrapper.querySelector('[data-mermaid-action="zoom-in"]').disabled,
    panPressed: wrapper.querySelector('[data-mermaid-action="pan"]').getAttribute("aria-pressed"),
    viewBox: [svg.viewBox.baseVal.width, svg.viewBox.baseVal.height],
    attr: [Number(svg.getAttribute("width")), Number(svg.getAttribute("height"))],
    point: {
      x: Math.round(box.left + Math.min(80, box.width / 3)),
      y: Math.round(box.top + Math.min(60, box.height / 3)),
    },
    viewPoint: {
      x: Math.round(viewBox.left + viewBox.width / 2),
      y: Math.round(viewBox.top + viewBox.height / 2),
    },
  };
})()`);
check(
  "控制項順序",
  bar.order.join(",") === "pan,zoom-out,zoom-reset,zoom-in,toggle,copy,save",
  bar.order.join(","),
);
check("渲染後沒有隱藏的按鈕", bar.hidden.length === 0, bar.hidden.join(","));
check("初始讀數 100%", bar.readout === "100%", bar.readout);
check("初始 − 可用、+ 可用", !bar.zoomOutDisabled && !bar.zoomInDisabled);
check("初始未開平移", bar.panPressed === "false");
check(
  "初始尺寸＝viewBox 自然尺寸",
  bar.attr[0] === Math.round(bar.viewBox[0]) && bar.attr[1] === Math.round(bar.viewBox[1]),
  `${bar.attr.join("x")} vs ${bar.viewBox.join("x")}`,
);

// 2b) 窄窗格：控制項要換行而不是被外殼的 overflow: hidden 切掉。
const narrow = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const bar = wrapper.querySelector(".md-mermaid-bar");
  const previous = wrapper.style.width;
  wrapper.style.width = "230px";
  const box = wrapper.getBoundingClientRect();
  const overflowing = Array.from(wrapper.querySelectorAll("[data-mermaid-action]"))
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.right > box.right + 0.5 || rect.left < box.left - 0.5 || rect.bottom > box.bottom + 0.5;
    })
    .map((button) => button.dataset.mermaidAction);
  const result = {
    overflowing,
    barHeight: Math.round(bar.getBoundingClientRect().height),
    barOverflow: bar.scrollWidth - bar.clientWidth,
  };
  wrapper.style.width = previous;
  return result;
})()`);
check(
  "230px 窄窗格：控制項換行且沒有被切掉",
  narrow.overflowing.length === 0 && narrow.barOverflow <= 0,
  JSON.stringify(narrow),
);

// 3) 放大／縮小／回到原始大小。
const click = (action) =>
  evaluate(
    `document.querySelector('[data-mermaid-action="${action}"]').click(); true`,
  );
const zoomState = () =>
  evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const svg = wrapper.querySelector(".md-mermaid-view svg");
  const view = wrapper.querySelector(".md-mermaid-view");
  return {
    readout: wrapper.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
    attr: [Number(svg.getAttribute("width")), Number(svg.getAttribute("height"))],
    viewBox: [svg.viewBox.baseVal.width, svg.viewBox.baseVal.height],
    scroll: [view.scrollLeft, view.scrollTop],
    overflow: [view.scrollWidth - view.clientWidth, view.scrollHeight - view.clientHeight],
  };
})()`);

await click("zoom-in");
await click("zoom-in");
const zoomed = await zoomState();
check("兩次 + → 120%（一次一級 10%）", zoomed.readout === "120%", zoomed.readout);
check(
  "120% 的寬高＝viewBox×1.2",
  zoomed.attr[0] === Math.round(zoomed.viewBox[0] * 1.2) &&
    zoomed.attr[1] === Math.round(zoomed.viewBox[1] * 1.2),
  `${zoomed.attr.join("x")}`,
);
await click("zoom-in");
const zoomed200 = await zoomState();
check("130% 時內容比容器大（可以平移）", zoomed200.overflow[0] > 0 || zoomed200.overflow[1] > 0, zoomed200.overflow.join(","));
await click("zoom-reset");
const reset = await zoomState();
check("回到原始大小", reset.readout === "100%" && reset.attr[0] === Math.round(reset.viewBox[0]), reset.readout);

// 4) 極端值：按住 + 一路到 400%，− 一路到 10%，兩端按鈕要停用。
for (let index = 0; index < 40; index += 1) {
  await click("zoom-in");
}
const maxed = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  return {
    readout: wrapper.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
    disabled: wrapper.querySelector('[data-mermaid-action="zoom-in"]').disabled,
  };
})()`);
check("上限 400% 且 + 停用", maxed.readout === "400%" && maxed.disabled, maxed.readout);
for (let index = 0; index < 40; index += 1) {
  await click("zoom-out");
}
const minned = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  return {
    readout: wrapper.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
    disabled: wrapper.querySelector('[data-mermaid-action="zoom-out"]').disabled,
  };
})()`);
check("下限 10% 且 − 停用", minned.readout === "10%" && minned.disabled, minned.readout);

// 回到 130% 測平移（已經比容器寬，可以拖）。
await click("zoom-reset");
await click("zoom-in");
await click("zoom-in");
await click("zoom-in");

// 5) 平移開關與拖曳。
await click("pan");
const panOn = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const view = wrapper.querySelector(".md-mermaid-view");
  return {
    pressed: wrapper.querySelector('[data-mermaid-action="pan"]').getAttribute("aria-pressed"),
    pan: view.classList.contains("is-pan"),
    cursor: getComputedStyle(view).cursor,
    userSelect: getComputedStyle(view).userSelect,
    scroll: [view.scrollLeft, view.scrollTop],
  };
})()`);
check("開啟平移：按下狀態＋grab 游標", panOn.pressed === "true" && panOn.pan && panOn.cursor === "grab", `${panOn.cursor} ${panOn.userSelect}`);

// 先把內容捲到中間，拖曳才有兩個方向都可以位移的空間。
const start = await evaluate(`(() => {
  const view = document.querySelector(".md-mermaid-view");
  const pane = document.querySelector(".markdown");
  view.scrollLeft = Math.round((view.scrollWidth - view.clientWidth) / 2);
  pane.scrollTop += 200;
  const box = view.getBoundingClientRect();
  const paneBox = pane.getBoundingClientRect();
  const clamp = (value, low, high) => Math.round(Math.min(Math.max(value, low), high));
  return {
    x: clamp(box.left + 150, paneBox.left + 40, Math.min(paneBox.right, window.innerWidth) - 40),
    y: clamp(box.top + 150, paneBox.top + 60, Math.min(box.bottom, window.innerHeight) - 40),
    scroll: [view.scrollLeft, pane.scrollTop],
  };
})()`);
const dragStart = start.scroll;
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
for (let step = 1; step <= 5; step += 1) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.x + step * 20,
    y: start.y + step * 20,
    button: "left",
    buttons: 1,
  });
}
const dragging = await evaluate(`document.querySelector(".md-mermaid-view").classList.contains("is-panning")`);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + 100, y: start.y + 100, button: "left", buttons: 0, clickCount: 1 });
const panned = await evaluate(`(() => {
  const view = document.querySelector(".md-mermaid-view");
  const pane = document.querySelector(".markdown");
  return {
    scroll: [view.scrollLeft, pane.scrollTop],
    selection: String(getSelection()),
  };
})()`);
check(
  "拖曳時游標 grabbing",
  dragging === true,
  String(dragging),
);
check(
  "往右下拖曳＝圖表往右下（水平捲圖表區、垂直捲窗格）且沒有選取文字",
  // 圖表不大時水平捲動上限本來就小（會被夾住），所以只看「有往正確方向動」。
  panned.scroll[0] < dragStart[0] &&
    panned.scroll[1] < dragStart[1] - 60 &&
    panned.selection === "",
  `${dragStart.join(",")} → ${panned.scroll.join(",")} sel="${panned.selection}"`,
);

// 6) Ctrl+滾輪：以游標為錨點縮放。
const wheelPoint = { x: start.x, y: start.y };
const anchorBefore = await evaluate(`(() => {
  const svg = document.querySelector(".md-mermaid-view svg");
  const box = svg.getBoundingClientRect();
  return {
    ratioX: (${wheelPoint.x} - box.left) / box.width,
    ratioY: (${wheelPoint.y} - box.top) / box.height,
    readout: document.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
  };
})()`);
await send("Input.dispatchMouseEvent", {
  type: "mouseWheel",
  x: wheelPoint.x,
  y: wheelPoint.y,
  deltaX: 0,
  deltaY: -120,
  modifiers: 2,
});
await sleep(200);
const anchorAfter = await evaluate(`(() => {
  const svg = document.querySelector(".md-mermaid-view svg");
  const box = svg.getBoundingClientRect();
  return {
    ratioX: (${wheelPoint.x} - box.left) / box.width,
    ratioY: (${wheelPoint.y} - box.top) / box.height,
    readout: document.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
  };
})()`);
const expectedAfterWheel = `${Number(anchorBefore.readout.replace("%", "")) + 10}%`;
check(
  "Ctrl+滾輪往上＝放大一級（10%）",
  anchorAfter.readout === expectedAfterWheel,
  `${anchorBefore.readout} → ${anchorAfter.readout}`,
);
check(
  "游標下的內容點留在原地",
  Math.abs(anchorAfter.ratioX - anchorBefore.ratioX) < 0.03 &&
    Math.abs(anchorAfter.ratioY - anchorBefore.ratioY) < 0.03,
  `${anchorBefore.ratioX.toFixed(3)}/${anchorBefore.ratioY.toFixed(3)} → ${anchorAfter.ratioX.toFixed(3)}/${anchorAfter.ratioY.toFixed(3)}`,
);

// 7) 記憶範圍：切到原始碼再切回來、切換主題重新渲染都要留著。
const snapshot = () =>
  evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const view = wrapper.querySelector(".md-mermaid-view");
  return {
    readout: wrapper.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
    scroll: [view.scrollLeft, view.scrollTop],
  };
})()`);
const beforeToggle = await snapshot();
await click("toggle");
const sourceMode = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const hidden = ["pan", "zoom-out", "zoom-reset", "zoom-in"].map(
    (action) => wrapper.querySelector('[data-mermaid-action="' + action + '"]').hidden,
  );
  return { hidden, label: wrapper.querySelector('[data-mermaid-action="toggle"]').textContent };
})()`);
check("原始碼模式收起縮放組", sourceMode.hidden.every(Boolean) && sourceMode.label === "顯示圖表", sourceMode.hidden.join(","));
await click("toggle");
const restored = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const view = wrapper.querySelector(".md-mermaid-view");
  return {
    readout: wrapper.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
    scroll: [view.scrollLeft, view.scrollTop],
    pan: wrapper.querySelector('[data-mermaid-action="pan"]').getAttribute("aria-pressed"),
  };
})()`);
check(
  "切回圖表：倍率與捲動位置都回來",
  restored.readout === beforeToggle.readout &&
    restored.scroll[0] === beforeToggle.scroll[0] &&
    restored.pan === "true",
  `${restored.readout} scroll=${restored.scroll.join(",")} pan=${restored.pan}`,
);

const beforeReload = await snapshot();
// 切換主題會讓圖表整批重新渲染（`renderAll` 會換掉外殼），狀態要跟著還原。
await evaluate(`document.querySelector('button[title="設定"]').click(); true`);
await waitFor(
  `!!Array.from(document.querySelectorAll("button")).find((item) => item.textContent.trim() === "深色")`,
  "設定頁的深色選項",
);
await evaluate(
  `Array.from(document.querySelectorAll("button")).find((item) => item.textContent.trim() === "深色").click(); true`,
);
await waitFor("!!document.querySelector('.md-mermaid-view svg[width]')", "重新渲染後的圖表", 120);
await sleep(800);
const reloaded = await evaluate(`(() => {
  const wrapper = document.querySelector(".md-mermaid");
  const view = wrapper.querySelector(".md-mermaid-view");
  const svg = view.querySelector("svg");
  return {
    readout: wrapper.querySelector('[data-mermaid-action="zoom-reset"]').textContent,
    width: Number(svg.getAttribute("width")),
    viewBoxWidth: svg.viewBox.baseVal.width,
    scroll: [view.scrollLeft, view.scrollTop],
    pan: wrapper.querySelector('[data-mermaid-action="pan"]').getAttribute("aria-pressed"),
    dark: document.documentElement.classList.contains("dark"),
  };
})()`);
check(
  "切換主題重新渲染後倍率與捲動位置還原",
  reloaded.readout === beforeReload.readout &&
    reloaded.width ===
      Math.round(reloaded.viewBoxWidth * (Number(beforeReload.readout.replace("%", "")) / 100)) &&
    reloaded.scroll[0] === beforeReload.scroll[0] &&
    reloaded.pan === "true",
  `${reloaded.readout} width=${reloaded.width}/${reloaded.viewBoxWidth} scroll=${reloaded.scroll.join(",")} dark=${reloaded.dark}`,
);
// 收尾：切回淺色並關掉設定頁（截圖要看得到圖表列）。
await evaluate(
  `Array.from(document.querySelectorAll("button")).find((item) => item.textContent.trim() === "淺色").click(); true`,
);
await sleep(600);
await evaluate(
  `document.querySelector('button[title="設定"]')?.click?.(); true`,
);
await sleep(400);

const image = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(shotPath, Buffer.from(image.result.data, "base64"));

console.log(results.join("\n"));
console.log(`截圖：${shotPath}`);
socket.close();
child.kill();
