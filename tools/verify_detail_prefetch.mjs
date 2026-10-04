// 详情页那个异步 chunk 的加载时机验收：**不碰卡片就不该下**，碰了/点了才下。
//
// 背景：上游在 App 挂载时就 `loadServerDetail()` —— 每个首页访客（哪怕从不点开节点）
// 都要多下 449.5KB / 17 个文件（recharts + d3 + redux）。改成按意图加载之后，
// 得证明两件事同时成立：① 不碰卡片时一个字节都不下；② 碰了/点了立刻能用（不是"省了但变慢"）。
//
// 用法: node tools/verify_detail_prefetch.mjs
//   同一只 Chrome 里跑四个场景：
//     ① 冷启动停在首页（不碰卡片）→ 不该请求 ServerDetail / recharts / d3 / redux 任何一条
//     ② 鼠标真的移到卡片上 → 立刻请求（真鼠标事件，React 的合成事件不吃 el.click()）
//     ③ 在同一处点下去 → 详情页渲染出来（曲线画出来了）
//     ④ 直接开 /server/1（外链/刷新那条路）→ 照样渲染得出来
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";

const PORT = 5350;
const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/manifest+json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

const node = (id, name, country) => ({
	id,
	name,
	group: "默认",
	country,
	os: "Debian GNU/Linux 12 (bookworm)",
	arch: "x86_64",
	virt: "vm",
	cpu_cores: 1,
	online: true,
	public: true,
	sort: id,
	last_seen: Math.floor(Date.now() / 1000),
	mem_total: 1020526592,
	disk_total: 10485864448,
	metrics: {
		cpu: 0.1,
		mem_used: 431800320,
		mem_total: 1020526592,
		disk_used: 1524510720,
		disk_total: 10485864448,
		net_rx: 867,
		net_tx: 465,
		uptime: 318521,
	},
});
const NODES = {
	admin: false,
	nodes: [node(1, "预取机 A", "US"), node(2, "预取机 B", "JP")],
};

/** 历史：详情页那几条曲线要有数据点，才判得出"渲染出来了"。 */
const HISTORY = {
	metrics: Array.from({ length: 24 }, (_, i) => ({
		ts: Math.floor(Date.now() / 1000) - (23 - i) * 600,
		cpu: 12 + (i % 7),
		mem_used: 431800320,
		disk_used: 1524510720,
		net_rx: 800 + i * 10,
		net_tx: 400 + i * 5,
	})),
	ping: [],
	probes: {},
	loss: {},
};

const server = createServer((req, res) => {
	const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
	if (path.startsWith("/api/")) {
		let body = {};
		if (path === "/api/me")
			body = {
				authed: false,
				github: false,
				public_page: true,
				site: "",
				site_name: "预取验收站",
				history_days: 30,
			};
		else if (path === "/api/nodes") body = NODES;
		else if (path.endsWith("/config")) body = {};
		else if (path.includes("/metrics")) body = HISTORY;
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		return res.end(JSON.stringify(body));
	}
	const file = join(
		"dist",
		normalize(path === "/" ? "/index.html" : path).replace(/^(\.\/)+/, ""),
	);
	if (!existsSync(file) || statSync(file).isDirectory()) {
		res.writeHead(200, { "Content-Type": TYPES[".html"] });
		return res.end(readFileSync("dist/index.html"));
	}
	res.writeHead(200, {
		"Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
		"Cache-Control": "no-store",
	});
	res.end(readFileSync(file));
});
const wss = new WebSocketServer({ server, path: "/api/ws" });
wss.on("connection", (socket) => {
	const push = () =>
		socket.readyState === 1 && socket.send(JSON.stringify(NODES));
	push();
	const timer = setInterval(push, 2000);
	socket.on("close", () => clearInterval(timer));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`dist/ 伺服在 ${BASE}/`);

const CHROME =
	[
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
		"/usr/bin/google-chrome",
	].find((p) => existsSync(p)) || "chrome";
let chrome;
let dbgPort;
let wsUrl = null;
for (let attempt = 0; attempt < 2 && !wsUrl; attempt++) {
	dbgPort = 9990 + Math.floor(Math.random() * 20);
	chrome?.kill();
	chrome = spawn(
		CHROME,
		[
			"--headless=new",
			`--remote-debugging-port=${dbgPort}`,
			"--remote-allow-origins=*",
			"--no-first-run",
			"--disable-gpu",
			"--hide-scrollbars",
			"--window-size=1440,900",
			"--disable-background-timer-throttling",
			`--user-data-dir=${process.env.TEMP || "/tmp"}/dzprefetch-${dbgPort}-${Date.now()}`,
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	for (let i = 0; i < 100 && !wsUrl; i++) {
		try {
			wsUrl = (
				await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()
			).find((t) => t.type === "page")?.webSocketDebuggerUrl;
		} catch {}
		if (!wsUrl) await sleep(300);
	}
}
if (!wsUrl) throw new Error("Chrome 起不来");

let id = 0;
const pending = new Map();
const requests = [];
const ws = new WebSocket(wsUrl);
await new Promise((r) => {
	ws.onopen = r;
});
const send = (m, p = {}) =>
	new Promise((res) => {
		const i = ++id;
		pending.set(i, res);
		ws.send(JSON.stringify({ id: i, method: m, params: p }));
	});
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
		return;
	}
	if (m.method === "Network.requestWillBeSent")
		requests.push(m.params.request.url);
};
const js = async (expr) =>
	(
		await send("Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true,
		})
	).result?.result?.value;
await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
	if (ok) pass++;
	else fail++;
};

/** 详情页那一坨（recharts + d3 + redux + 详情页本身）有没有被请求过。 */
const DETAIL_CHUNKS =
	/ServerDetail|recharts|d3-|@reduxjs|immer|react-redux|decimal\.js/;
const detailHits = () =>
	requests.filter((u) => DETAIL_CHUNKS.test(u)).map((u) => u.split("/").pop());

async function waitFor(expr, label, timeoutMs = 25000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ((await js(`!!(${expr})`)) === true) return true;
		await sleep(150);
	}
	throw new Error(`等不到「${label}」：${expr}`);
}

console.log("\n════ ① 冷启动停在首页（不碰卡片）════");
requests.length = 0;
await send("Page.navigate", { url: `${BASE}/` });
await waitFor("document.body.innerText.includes('预取机 A')", "节点列表出来");
await sleep(4000); // 留够时间让「预取」这类行为露头
check(
	"不碰卡片时没有请求详情页那一坨",
	detailHits().length === 0,
	`已请求的脚本 ${requests.filter((u) => /\.js(\?|$)/.test(u)).length} 个${detailHits().length ? `：${detailHits().join(" ")}` : ""}`,
);

console.log("\n════ ② 鼠标真的移到卡片上 ════");
const point = await js(`(() => {
  const el = [...document.querySelectorAll('section.server-card-list > *')][0]
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(40, r.height / 2)) }
})()`);
check("找得到第一张卡片", Boolean(point), JSON.stringify(point));
requests.length = 0;
if (point) {
	// 真鼠标事件：先移出再移入，React 的 onPointerEnter 才会触发。
	await send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: 5,
		y: 5,
		pointerType: "mouse",
	});
	await send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: point.x,
		y: point.y,
		pointerType: "mouse",
	});
}
let hovered = false;
for (let i = 0; i < 40 && !hovered; i++) {
	hovered = detailHits().length > 0;
	if (!hovered) await sleep(150);
}
check(
	"指针碰到卡片后立刻去拉详情页那一坨",
	hovered,
	`${detailHits().slice(0, 3).join(" ")}${detailHits().length > 3 ? " …" : ""}`,
);

console.log("\n════ ③ 在同一处点下去 ════");
requests.length = 0;
if (point) {
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: point.x,
			y: point.y,
			button: "left",
			clickCount: 1,
			pointerType: "mouse",
		});
	}
}
await waitFor(
	"document.querySelectorAll('.recharts-surface').length > 0",
	"详情页曲线画出来",
	30000,
);
check("详情页渲染出来（曲线画出来了）", true);
check(
	"详情页的 URL 是 /server/1",
	(await js("location.pathname")) === "/server/1",
	`${await js("location.pathname")}`,
);

console.log("\n════ ④ 直接开 /server/1（外链/刷新那条路）════");
requests.length = 0;
await send("Page.navigate", { url: `${BASE}/server/1` });
await waitFor(
	"document.querySelectorAll('.recharts-surface').length > 0",
	"直开详情页曲线画出来",
	30000,
);
check("直开详情页也能渲染（没有预取也不受影响）", true);
check(
	"直开时确实拉了那个 chunk",
	detailHits().length > 0,
	`${detailHits().slice(0, 3).join(" ")}`,
);

console.log(`\n${pass} PASS / ${fail} FAIL`);
chrome?.kill();
wss.close();
server.close();
process.exit(fail ? 1 : 0);
