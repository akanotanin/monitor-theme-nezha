// 「WS 连不上时页面还活着吗」的验收。
//
// 背景：探针的实时数据走 `/api/ws`。反代没转发 `Upgrade`（或 WS 被 WAF/防火墙拦）时，
// 改造前整站只剩一个「离线」徽标和一张永远空白的列表 —— 而 `/api/nodes` 明明照常能用
// （实测：把 WS 摘掉后等了 27 秒，一个节点都没出来）。
//
// 用法: node tools/verify_ws_fallback.mjs
//   一个进程里跑两个场景，同一只 Chrome：
//     ① 有 WS：列表出来、徽标「在线」、且**没有**开 5 秒兜底轮询（/api/nodes 的间隔仍是 ~10s）
//     ② 把 WS 关掉再刷新：列表**照样出来**、徽标不再写「离线」、/api/nodes 以 ~5s 的节奏在轮询
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";

const PORT = 5340;
const OBSERVE_MS = 16000;
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
	virt: "vm",
	arch: "x86_64",
	cpu_cores: 1,
	online: true,
	public: true,
	sort: id,
	mem_total: 1020526592,
	disk_total: 10485864448,
	last_seen: Math.floor(Date.now() / 1000),
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
	nodes: [
		node(1, "测试机 A", "US"),
		node(2, "测试机 B", "JP"),
		node(3, "测试机 C", "DE"),
	],
};

/** /api/nodes 每次被请求的时刻（用来判「有没有 5 秒一次的兜底轮询」）。 */
let apiNodesAt = [];

const server = createServer((req, res) => {
	const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
	if (path.startsWith("/api/")) {
		if (path === "/api/nodes") apiNodesAt.push(Date.now());
		let body = {};
		if (path === "/api/me")
			body = {
				authed: false,
				github: false,
				public_page: true,
				site: "",
				site_name: "兜底测试站",
			};
		else if (path === "/api/nodes") body = NODES;
		else if (path.endsWith("/config")) body = {};
		else if (path.includes("/metrics"))
			body = { metrics: [], probes: {}, loss: {}, ping: [] };
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		return res.end(JSON.stringify(body));
	}
	const file = join(
		"dist",
		normalize(path === "/" ? "/index.html" : path).replace(/^(\.[/\\])+/, ""),
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

let wss = new WebSocketServer({ server, path: "/api/ws" });
const pushFrame = (socket) =>
	socket.readyState === 1 && socket.send(JSON.stringify(NODES));
const wire = (socket) => {
	pushFrame(socket);
	const timer = setInterval(() => pushFrame(socket), 2000);
	socket.on("close", () => clearInterval(timer));
};
wss.on("connection", wire);
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
	dbgPort = 9970 + Math.floor(Math.random() * 20);
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
			"--user-data-dir=" +
				(process.env.TEMP || "/tmp") +
				"/wsfb-" +
				dbgPort +
				"-" +
				Date.now(),
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
	}
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

/** 页面上「状态徽标」那段文本（Header 里那颗点 + 在线/离线）。 */
const badge = async () =>
	String(
		await js(`(() => {
      const dot = [...document.querySelectorAll('span')].find((s) => /rounded-full/.test(s.className) && /bg-(green|red)-500/.test(s.className))
      if (!dot) return ''
      const box = dot.closest('button')
      return (box ? box.innerText : '') + '|' + dot.className
    })()`),
	);

async function run(name, { waitNodes }) {
	const navAt = Date.now();
	await send("Page.navigate", { url: `${BASE}/` });
	let ready = false;
	for (let i = 0; i < 200 && !ready; i++) {
		ready = Boolean(await js(`document.body.innerText.includes('测试机 A')`));
		if (!ready) await sleep(100);
	}
	console.log(
		`\n════ ${name} ════\n   列表出现耗时 ${Date.now() - navAt}ms（超时上限 20s）`,
	);
	check(
		"节点列表出得来",
		ready,
		`第 1 台=${JSON.stringify(await js(`document.body.innerText.includes('测试机 A')`))}`,
	);
	const b = await badge();
	console.log(`   状态徽标：${JSON.stringify(b)}`);
	check(
		"状态徽标写的是「在线」而不是「离线」",
		!/离线|offline/i.test(b) && /在线|online/i.test(b),
		b,
	);

	apiNodesAt = [];
	await sleep(OBSERVE_MS);
	const gaps = apiNodesAt.slice(1).map((t, i) => t - apiNodesAt[i]);
	const minGap = gaps.length ? Math.min(...gaps) : Number.POSITIVE_INFINITY;
	console.log(
		`   /api/nodes 在 ${OBSERVE_MS / 1000}s 里被请求 ${apiNodesAt.length} 次，最小间隔 ${minGap === Number.POSITIVE_INFINITY ? "—" : Math.round(minGap)}ms`,
	);
	const stillThere = Boolean(
		await js(`document.body.innerText.includes('测试机 A')`),
	);
	check("观察期结束时列表还在（数据是活的）", stillThere);
	return { minGap, count: apiNodesAt.length, waitNodes };
}

// ① 有 WS
const okRun = await run("① 有 WebSocket", { waitNodes: true });
check(
	"WS 正常时不该开兜底轮询（/api/nodes 的最小间隔仍 ≥ 8s）",
	okRun.minGap >= 8000,
	`最小间隔 ${Math.round(okRun.minGap)}ms`,
);

// ② 把 WS 关掉：之后 /api/ws 的升级请求没有 handler，握手失败
wss.close();
wss = null;
console.log("\n（已关闭 WebSocket 服务，模拟反代没转发 Upgrade）");
const downRun = await run("② 没有 WebSocket", { waitNodes: true });
check(
	"WS 断了时兜底轮询在工作（/api/nodes 出现 ≤ 6.5s 的间隔）",
	downRun.minGap <= 6500,
	`最小间隔 ${Math.round(downRun.minGap)}ms`,
);

writeFileSync(
	process.env.WSFB_OUT || `${process.env.TEMP || "."}/ws-fallback.json`,
	`${JSON.stringify({ ok: okRun, down: downRun }, null, 1)}\n`,
);
console.log(`\n${pass} PASS / ${fail} FAIL`);
chrome?.kill();
wss?.close();
server.close();
process.exit(fail ? 1 : 0);
