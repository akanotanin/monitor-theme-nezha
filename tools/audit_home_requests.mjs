// 一次性审计：首页稳定后 25 秒里，浏览器到底还在拉什么、拉多少。
// （站点身份/地图那些护栏管的是「改完了没坏」，这个管「还有没有白拉的」）
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";

const PORT = 5330;
const OBSERVE_MS = Number(process.env.AUDIT_MS || 25000);
// AUDIT_NOWS=1：不提供 WebSocket（模拟反代没转发 Upgrade / 探针的 WS 端口不可达）
const NO_WS = process.env.AUDIT_NOWS === "1";
// AUDIT_THROTTLE=<kbps>：限速跑，用来看首屏到底被什么拖慢
const THROTTLE = Number(process.env.AUDIT_THROTTLE || 0);
const ME_DELAY = Number(process.env.AUDIT_ME_DELAY || 0);
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
	cpu_name: "AMD EPYC Processor",
	cpu_cores: 1,
	kernel: "6.1.0-53-cloud-amd64",
	agent_version: "1.0.0",
	online: true,
	public: true,
	sort: id,
	mem_total: 1020526592,
	disk_total: 10485864448,
	traffic_limit: 536870912000,
	month_start: "2026-09-21",
	expires_at: "2027-07-21",
	expires_in: 299,
	billing_cycle: "yearly",
	currency: "CNY",
	price: 349,
	last_seen: Math.floor(Date.now() / 1000),
	metrics: {
		cpu: 0.1,
		load: [0.1, 0.2, 0.3],
		mem_used: 431800320,
		mem_total: 1020526592,
		swap_used: 0,
		swap_total: 0,
		disk_used: 1524510720,
		disk_total: 10485864448,
		net_rx: 867,
		net_tx: 465,
		procs: 75,
		tcp: 16,
		udp: 3,
		uptime: 318521,
		month_rx: 4650258264,
		month_tx: 4351673970,
		total_rx: 5707805336,
		total_tx: 5203609923,
	},
});
const NODES = {
	admin: false,
	nodes: [
		node(1, "测试机 A", "US"),
		node(2, "测试机 B", "JP"),
		node(3, "测试机 C", "DE"),
		node(4, "测试机 D", "SG"),
	],
};

const apiCount = {};
const server = createServer((req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	const path = url.pathname;
	// 按「路径 + 查询串」计数：带 ?theme-title=1 的是站名早跑脚本那条，跟 App 那条不是一回事
	apiCount[url.pathname + url.search] =
		(apiCount[url.pathname + url.search] || 0) + 1;
	if (path.startsWith("/api/")) {
		let body = {};
		if (path === "/api/me")
			body = {
				authed: false,
				github: false,
				public_page: true,
				site: "",
				site_name: "审计站",
			};
		else if (path === "/api/nodes") body = NODES;
		else if (path.endsWith("/config")) body = {};
		else if (path.includes("/metrics"))
			body = { metrics: [], probes: {}, loss: {}, ping: [] };
		else if (path.includes("/groups")) body = { groups: [] };
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		// AUDIT_ME_DELAY=<ms>：本机 RTT≈0，/api/me 的两条并发请求会先后完成、看不出合并效果；
		// 给这条接口加个真实网络量级的延迟，才验得出「并发的那份被合成一条」。
		if (path === "/api/me" && ME_DELAY) {
			return setTimeout(() => res.end(JSON.stringify(body)), ME_DELAY);
		}
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
const wss = NO_WS ? null : new WebSocketServer({ server, path: "/api/ws" });
let frames = 0;
let wsConns = 0;
wss?.on("connection", (socket) => {
	wsConns++;
	const push = () => {
		if (socket.readyState !== 1) return;
		frames++;
		socket.send(JSON.stringify(NODES));
	};
	push();
	const timer = setInterval(push, 2000);
	socket.on("close", () => clearInterval(timer));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${PORT}`;

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
	dbgPort = 9950 + Math.floor(Math.random() * 20);
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
				"/audit-" +
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
const reqs = [];
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
	if (m.method === "Network.responseReceived") {
		reqs.push({
			url: m.params.response.url,
			type: m.params.type,
			status: m.params.response.status,
			mime: m.params.response.mimeType,
			fromCache: m.params.response.fromDiskCache === true,
			at: Date.now(),
		});
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
if (THROTTLE) {
	await send("Network.emulateNetworkConditions", {
		offline: false,
		latency: 150,
		downloadThroughput: (THROTTLE * 1024) / 8,
		uploadThroughput: (THROTTLE * 1024) / 8,
	});
	console.log(`网络限速：${THROTTLE} kbps / 150ms`);
}

const navAt = Date.now();
await send("Page.navigate", { url: `${BASE}/` });
let ready = false;
for (let i = 0; i < 250 && !ready; i++) {
	ready = Boolean(await js(`document.body.innerText.includes('测试机 A')`));
	if (!ready) await sleep(100);
}
const readyAt = Date.now();
console.log(
	`页面就绪耗时 ${readyAt - navAt}ms${ready ? "" : "（★ 超时：列表一直没出来）"} —— 从这个时刻起观察 ${OBSERVE_MS / 1000}s`,
);
console.log(
	`WS 连接数=${wsConns} 帧数=${frames}  页面里连接状态文案=${JSON.stringify(await js(`(document.querySelector('.header-handles') || {}).innerText || ''`))}`,
);
const base = reqs.length;
await sleep(OBSERVE_MS);

const after = reqs.slice(base);
const bytesOf = (list) =>
	list.reduce((sum, r) => {
		if (r.fromCache) return sum;
		try {
			const p = new URL(r.url).pathname;
			const f = join("dist", p);
			return (
				sum +
				(existsSync(f) && !statSync(f).isDirectory() ? statSync(f).size : 0)
			);
		} catch {
			return sum;
		}
	}, 0);

const group = (list) => {
	const m = new Map();
	for (const r of list) {
		const key = r.url.replace(BASE, "").split("?")[0];
		const cur = m.get(key) || { n: 0, bytes: 0, type: r.type };
		cur.n++;
		if (!r.fromCache) {
			try {
				const f = join("dist", new URL(r.url).pathname);
				if (existsSync(f) && !statSync(f).isDirectory())
					cur.bytes += statSync(f).size;
			} catch {}
		}
		m.set(key, cur);
	}
	return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
};

console.log(
	`\n观察窗口 ${OBSERVE_MS / 1000}s 里的请求（${after.length} 条，${(bytesOf(after) / 1024).toFixed(1)} KB 非缓存）:`,
);
for (const [url, info] of group(after))
	console.log(
		`   ${String(info.n).padStart(3)}×  ${(info.bytes / 1024).toFixed(1).padStart(8)} KB  ${url}`,
	);

const firstLoadBytes = bytesOf(reqs.filter((r) => r.at <= readyAt));
console.log(
	`\n首屏（到就绪为止）：${(firstLoadBytes / 1024).toFixed(1)} KB 非缓存 / ${reqs.filter((r) => r.at <= readyAt).length} 条请求`,
);
console.log(`WS 帧数：${frames}（每 2s 一帧）`);
console.log(
	`\n<html lang> = ${JSON.stringify(await js(`document.documentElement.lang`))}`,
);
console.log(
	`界面语言 = ${JSON.stringify(await js(`(document.documentElement.dataset.i18n || (window.i18n && window.i18n.language) || '' )`))}`,
);
console.log(
	`localStorage.language = ${JSON.stringify(await js(`localStorage.getItem('language')`))}`,
);
console.log(
	`首屏后加载的 JS chunk：${
		group(after)
			.filter(([u]) => u.endsWith(".js"))
			.map(
				([u, i]) => `${u.split("/").pop()}(${(i.bytes / 1024).toFixed(0)}KB)`,
			)
			.join(" ") || "（无）"
	}`,
);

// 页面自己记的资源时间线：每个资源的 responseEnd（相对导航起点，ms）
const timeline = JSON.parse(
	await js(`JSON.stringify(
  performance.getEntriesByType('resource').map((e) => [e.name.replace(location.origin, ''), Math.round(e.responseEnd), Math.round(e.transferSize || 0)])
)`),
);
const BUCKETS = {
	首屏必需:
		/^\/($|assets\/(index|rolldown|react-dom|@radix-ui|@tanstack|@floating-ui|sonner|i18next|react-i18next|react-router|lucide-react|cmdk|class-variance|dayjs|tailwind-merge|utils|@heroicons|country-flag-icons)[.-])|^\/(flags|vendor)\//,
	"详情页预取(recharts 等)":
		/assets\/(ServerDetail|recharts|d3-scale|d3-shape|d3-color|d3-format|d3-path|d3-interpolate|@reduxjs|immer|react-redux|es-toolkit|decimal|eventemitter3|NetworkChart|react-is|i18n-iso|diacritics)[.-]/,
	"地图(按需)": /assets\/(GlobalMap|d3-geo)[.-]/,
};
const stat = {};
for (const [url, end, size] of timeline) {
	for (const [name, re] of Object.entries(BUCKETS)) {
		if (re.test(url)) {
			if (!stat[name]) stat[name] = { n: 0, bytes: 0, lastEnd: 0 };
			const s = stat[name];
			s.n++;
			s.bytes += size;
			s.lastEnd = Math.max(s.lastEnd, end);
			break;
		}
	}
}
console.log("\n—— 资源时间线（responseEnd，相对导航起点）——");
for (const [name, s] of Object.entries(stat)) {
	console.log(
		`   ${name}: ${s.n} 个 / ${(s.bytes / 1024).toFixed(1)} KB / 最后一个落地 ${s.lastEnd}ms`,
	);
}
const tail = timeline
	.filter(([, e]) => e > 0)
	.sort((a, b) => b[1] - a[1])
	.slice(0, 8);
console.log(
	`   最晚落地的 8 个：${tail.map(([u, e, b]) => `${u.split("/").pop()}@${e}ms(${(b / 1024).toFixed(0)}KB)`).join(" ")}`,
);
console.log(`\nAPI 请求计数：${JSON.stringify(apiCount)}`);

writeFileSync(
	process.env.AUDIT_OUT || `${process.env.TEMP || "."}/audit-home.json`,
	`${JSON.stringify({ readyMs: readyAt - navAt, frames, all: reqs.map((r) => ({ url: r.url, type: r.type, at: r.at - navAt })), after }, null, 1)}\n`,
);
chrome?.kill();
wss?.close();
server.close();
