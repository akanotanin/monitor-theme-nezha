// 「延迟监控」改成「展开才拉全量」的验收。
//
// 背景：首页为每个在线节点拉 `hours=720&series=ping` 的原始 ping 序列去填「延迟监控」块，
// 而那块默认是收起的。实测真 hub（9 条探测线路）单节点 791KB → 7 节点 ≈ 5.5MB/次访问
// （开着的标签页 55 秒一过整份重来）。改造后：默认只拉 `hours=1` 的轻量窗口答
// 「有没有延迟监控数据」，全量 30 天在**展开时**（showServices=1）才由 ServiceTracker 拉。
//
// 用法: node tools/verify_service_lazy.mjs [baseUrl?]
//   同进程同一只 Chrome 两个场景：
//     ① 默认收起 —— 有 `hours=1&series=ping`、**没有** `hours=720&series=ping`
//     ② 手动展开（localStorage showServices=1 再刷新）—— 出现 `hours=720&series=ping`
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";

const PORT = 5350;
const OBSERVE_MS = 8000;
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
	os: "Linux",
	virt: "vm",
	arch: "x86_64",
	cpu_cores: 1,
	online: true,
	public: true,
	sort: id,
	mem_total: 1020526592,
	disk_total: 10485864448,
	last_seen: Math.floor(Date.now() / 1000),
	metrics: { cpu: 0.1, mem_used: 1, mem_total: 1, disk_used: 1, disk_total: 1 },
});
const NODES = {
	admin: false,
	nodes: [node(1, "测试机 A", "US"), node(2, "测试机 B", "JP")],
};

const PROBES = { 1: "北京电信", 2: "北京联通" };
const now = Math.floor(Date.now() / 1000);
// 两条有采样的 ping 行 → buildServiceResponse 能产出 services → hasServices=true（像真站）
const PING = [
	{ ts: now, latency: 22, task_id: 1 },
	{ ts: now, latency: 31, task_id: 2 },
];

/** 页面真下了哪些 /api/nodes/<id>/metrics 请求（含 query）—— 这是本护栏的主判据。 */
const serviceCalls = [];

const server = createServer((req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	const path = url.pathname;
	if (path.startsWith("/api/")) {
		let body = {};
		if (path === "/api/me")
			body = {
				authed: false,
				github: false,
				public_page: true,
				site: "",
				site_name: "延迟监控验收站",
			};
		else if (path === "/api/nodes") body = NODES;
		else if (path.endsWith("/config")) body = {};
		else if (path.includes("/metrics")) {
			serviceCalls.push(url.pathname + url.search);
			body = { metrics: [], probes: PROBES, loss: {}, ping: PING };
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(JSON.stringify(body));
	}
	if (path === "/api/ws") {
		// 手势交给下面的 WebSocketServer（http upgrade 不在这里）
		return res.writeHead(426).end();
	}
	const file = normalize(path) === "/index.html" ? "index.html" : path;
	const disk = join(process.cwd(), "dist", file);
	if (path === "/") {
		const html = readFileSync(
			join(process.cwd(), "dist", "index.html"),
			"utf8",
		);
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		return res.end(html);
	}
	if (existsSync(disk) && statSync(disk).isFile()) {
		res.writeHead(200, { "Content-Type": TYPES[extname(file)] });
		return res.end(readFileSync(disk));
	}
	res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: "/api/ws" });
wss.on("connection", (ws) => {
	const wire = () => {
		if (ws.readyState === 1) ws.send(JSON.stringify(NODES));
	};
	wire();
	const timer = setInterval(wire, 4000);
	ws.on("close", () => clearInterval(timer));
});

await new Promise((r) => server.listen(PORT, r));
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
	dbgPort = 9990 + Math.floor(Math.random() * 10);
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
			`--user-data-dir=${process.env.TEMP || "/tmp"}/srvlazy-${dbgPort}-${Date.now()}`,
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
const cdp = new WebSocket(wsUrl);
await new Promise((r) => {
	cdp.onopen = r;
});
const send = (m, p = {}) =>
	new Promise((res) => {
		const i = ++id;
		pending.set(i, res);
		cdp.send(JSON.stringify({ id: i, method: m, params: p }));
	});
cdp.onmessage = (e) => {
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

async function open() {
	serviceCalls.length = 0;
	await send("Page.navigate", { url: `${BASE}/` });
	let ready = false;
	for (let i = 0; i < 200 && !ready; i++) {
		ready = Boolean(await js(`document.body.innerText.includes('测试机 A')`));
		if (!ready) await sleep(100);
	}
	await sleep(OBSERVE_MS);
}

console.log("\n════ 场景① 默认（延迟监控收起）═══");
await open();
const callsA = [...serviceCalls];
const a1 = callsA.filter((u) => u.includes("hours=1&series=ping"));
const a720 = callsA.filter((u) => u.includes("hours=720&series=ping"));
console.log(
	`   history=1: ${a1.length} 次  | history=720: ${a720.length} 次\n   ${callsA.join("  ") || "（无）"}`,
);
check(
	"默认只拉 hours=1 的轻量窗口（有）",
	a1.length > 0,
	`hours=1×${a1.length}`,
);
check(
	"默认**不**拉 hours=720 全量（改前这里是 2 次）",
	a720.length === 0,
	`hours=720×${a720.length}（改前每个在线节点都会拉一次）`,
);

console.log("\n════ 场景② 展开（点一下「延迟监控」按钮）═══");
serviceCalls.length = 0;
// 重新加载成收起态，然后像真用户一样点开「延迟监控」按钮（展开态本来就不跨刷新保留，
// 上游 1.0.13 里由「数据没到时先把 showServices 归零」那个 effect 兜着 —— 改 localStorage
// 再刷新不会真的展开，这与本改动无关）。
await open();
const btnExpr = `[...document.querySelectorAll('button')].filter(b=>{const s=b.querySelector('svg'); return s && (/size-\\[13px\\]/.test(s.getAttribute('class')||'') || /rounded-\\[50px\\]/.test(b.className))})`;
let clicked = 0;
for (let i = 0; i < 200 && clicked === 0; i++) {
	clicked = Number(
		await js(
			`(() => { const btns=${btnExpr}; const n=btns.length; if (!n) return 0; btns.forEach(b=>b.click()); return n; })()`,
		),
	);
	if (!clicked) await sleep(100);
}
await sleep(OBSERVE_MS);
const callsB = [...serviceCalls];
const b720 = callsB.filter((u) => u.includes("hours=720&series=ping"));
const b1 = callsB.filter((u) => u.includes("hours=1&series=ping"));
console.log(
	`\n  点到按钮: ${clicked}  |  history=720: ${b720.length} 次  | history=1: ${b1.length} 次\n   ${callsB.join("  ") || "（无）"}`,
);
if (!clicked) console.log("   （圆钮没点到 —— 是不是 hasServers 没起来？）");
check(
	"展开后才出现 hours=720 全量（覆盖在线节点）",
	clicked && b720.length >= 1,
	`hours=720×${b720.length}`,
);

console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
chrome?.kill();
server.close();
process.exit(fail === 0 ? 0 : 1);
