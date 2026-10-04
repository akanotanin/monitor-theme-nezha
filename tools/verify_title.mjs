// 标签页标题的验收：把一次加载里 <title> 的每一次变化连时间点录下来，
// 断言「刷新时零跳变、首次访问最多一跳」，以及「那条早问的请求迟到也不许改标题」。
//
// 用法：node tools/verify_title.mjs ['站名'] [baseUrl]
//   不给 baseUrl：本机起一个静态 + 桩接口的服务器（不经隧道），四项全跑。
//   给了 baseUrl：直接打在真 hub 上（桩服务器才有计数与「过期站名」那两项，会明确跳过）。
//
// 为什么能这么录：标题的写入发生在三个地方（index.html 的静态值、nezha-title-probe.js、
// Header 的 effect），headless 里靠 Page.addScriptToEvaluateOnNewDocument 在文档刚建好时挂一个
// 5ms 的轮询，记下每一次真的变了的时间点——肉眼看到的那几跳，就是这几条记录。
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SITE = process.argv[2] || "自家の探针";
const PORT = 5300;
// 每一步等页面安静的时长。本机毫秒级就够；经隧道/代理打真 hub 时要给大些。
const SETTLE = Number(process.env.TITLE_WAIT_MS || 4000);
const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".webp": "image/webp",
};

// 与上游一致的节点形状（Monitor 的 /api/nodes）：页面照常渲染，标题与它无关。
const node = (id, name, group) => ({
	id,
	name,
	group,
	online: true,
	public: true,
	sort: id,
	country: "JP",
	os: "Debian GNU/Linux 12 (bookworm)",
	virt: "vm",
	arch: "x86_64",
	cpu_name: "AMD EPYC Processor",
	cpu_cores: 1,
	kernel: "6.1.0-53-cloud-amd64",
	agent_version: "1.0.0",
	mem_total: 1020526592,
	swap_total: 0,
	disk_total: 10485864448,
	traffic_limit: 536870912000,
	traffic_mode: "sum",
	billing_cycle: "yearly",
	currency: "CNY",
	price: 349,
	expires_at: "2027-07-21",
	expires_in: 299,
	month_start: "2026-09-21",
	traffic_reset_day: 21,
	day_rx: 2140585887,
	day_tx: 2191393745,
	month_rx: 4650258264,
	month_tx: 4351673970,
	total_rx: 5707805336,
	total_tx: 5203609923,
	last_seen: 1790311292,
	metrics: {
		cpu: 0,
		load: [0, 0, 0],
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
const NODES = { nodes: [node(1, "节点一", "东京"), node(2, "节点二", "")] };

// nezha-title-probe.js 那条 /api/me 带 ?theme-title=1（hub 不看查询串），可以单独被拖慢、
// 并让它回一个**与真站名不同**的值：这样「迟到的响应不许改标题」才是可观测的断言——
// React 早就写好了真站名，那条迟到的若还去写，标题就会变成这个过期值。
let titleProbeDelay = 0;
let titleProbeHits = 0;
// 整站所有 /api/me（含 React 那条）：冷启动只该有一条 —— 早跑脚本先问过，
// 桥接层接过来复用（见 src/monitor/bridge.ts 的 fetchMeOnce）。
let titleProbeStaleName = null;
let meHits = 0;
const server = createServer((req, res) => {
	const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
	if (path.startsWith("/api/")) {
		if (path === "/api/me") {
			meHits++;
			const isProbe = req.url.includes("theme-title");
			if (isProbe) titleProbeHits++;
			const name = isProbe && titleProbeStaleName ? titleProbeStaleName : SITE;
			const reply = () => {
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
				});
				res.end(
					JSON.stringify({
						authed: false,
						github: false,
						public_page: true,
						site: `http://127.0.0.1:${PORT}`,
						site_name: name,
					}),
				);
			};
			return isProbe && titleProbeDelay
				? void setTimeout(reply, titleProbeDelay)
				: void reply();
		}
		const body =
			path === "/api/nodes"
				? NODES
				: path.endsWith("/config")
					? {}
					: path.includes("/metrics")
						? { metrics: [], probes: [], loss: {} }
						: { nodes: [] };
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
const BASE = process.argv[3] || `http://127.0.0.1:${PORT}`;
const REAL_HUB = !!process.argv[3];
if (!REAL_HUB) {
	await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
	console.log(`dist/ 伺服在 ${BASE}/  站名=${SITE}`);
} else {
	console.log(
		`直接打真 hub: ${BASE}  站名=${SITE}（本机不伺服 dist，桩计数与过期值两项跳过）`,
	);
}

const CHROME =
	[
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
		"/usr/bin/google-chrome",
	].find((p) => existsSync(p)) || "chrome";
// 打真 hub 时可能要借代理出去（CHROME_PROXY=http://127.0.0.1:2080）；
// 站点把管理面/写操作限制在固定 IP 时，访客面本来就能直连，不必开。
const PROXY = process.env.CHROME_PROXY
	? [`--proxy-server=${process.env.CHROME_PROXY}`]
	: [];
let chrome,
	dbgPort,
	wsUrl = null;
for (let attempt = 0; attempt < 2 && !wsUrl; attempt++) {
	dbgPort = 9940 + Math.floor(Math.random() * 50);
	chrome?.kill();
	chrome = spawn(
		CHROME,
		[
			"--headless=new",
			`--remote-debugging-port=${dbgPort}`,
			"--remote-allow-origins=*",
			...PROXY,
			"--no-first-run",
			"--disable-gpu",
			"--hide-scrollbars",
			"--window-size=1440,900",
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--user-data-dir=" +
				(process.env.TEMP || "/tmp") +
				"/titlecheck-nd-" +
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
if (!wsUrl)
	throw new Error(
		"Chrome 起不来：先看看是不是堆了太多测试实例（按 --user-data-dir 前缀清一遍）",
	);

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
const wsSendBin = (m, p = {}) => {
	const i = ++id;
	ws.send(JSON.stringify({ id: i, method: m, params: p }));
};
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

// 文档一建好就装上记录器：5ms 轮一次 document.title，变了就连时刻记下来。
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: `window.__titleLog = []
  let __last = null
  setInterval(() => {
    const t = document.title
    if (t !== __last) { __last = t; window.__titleLog.push([Math.round(performance.now()), t]) }
    // React 什么时候接手的（Header.tsx 写标题前会置这个标志）——用来判断标题是不是
    // 由那个早跑脚本贴上的，而不是等入口包执行完才写。
    if (window.__titleOwned && !window.__ownedAt) window.__ownedAt = Math.round(performance.now())
  }, 5)`,
});

let pass = 0,
	fail = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
	if (ok) pass++;
	else fail++;
};
const log = async () =>
	(
		JSON.parse(await js("JSON.stringify(window.__titleLog || [])")) || []
	).filter(([, t]) => t !== "");
const show = (lines) =>
	lines
		.map(([t, title]) => `    +${String(t).padStart(5)}ms  ${title}`)
		.join("\n");
const ownedAt = async () => Number(await js("window.__ownedAt || 0"));
// 这一版标题是谁贴的："cache"=早跑脚本贴的缓存、"fetch"=它自己早问来的。
// 用它而不是毫秒数当判据——链路快慢会让时间断言假红假绿，而「走的是哪条路」是确定的。
const probeSource = async () =>
	String((await js('window.__titleProbeSource || ""')) || "");

const FALLBACK = "哪吒监控 Nezha Monitoring";

// 一、首次访问：这个 origin 上还没有缓存（全新 profile），静态 HTML 只能先给占位值，
//    那个早跑脚本会抢在入口包之前去问一次 /api/me，所以这一跳应当发生得很早。
await send("Page.navigate", { url: `${BASE}/` });
await sleep(SETTLE);
let lines = await log();
let owned = await ownedAt();
console.log(
	`\n首次访问（无缓存）:\n${show(lines)}` +
		`\n    React 接手=${owned || "—"}ms`,
);
check(
	"首次访问末值 = 站名",
	lines.at(-1)?.[1] === SITE,
	`末值=${lines.at(-1)?.[1]}`,
);
check(
	"首次访问里没有主题名那一跳（Monitor Nezha）",
	!lines.some(([, t]) => t.includes("Monitor Nezha")),
);
check(
	"首次访问最多一跳（占位值 → 站名）",
	lines.length <= 2,
	`${lines.length} 条记录`,
);
console.log(
	`    占位值存活 ${lines.length > 1 ? lines[1][0] - lines[0][0] : 0}ms（跳变点 ${lines[1]?.[0] ?? "—"}ms）`,
);
// 用机制断言而不是时间断言：时间随机器/链路浮动，而「标题是在 React 接手之前贴上的吗」是确定的。
check(
	"首次访问的站名是在 React 接手之前贴上的（没在等那几百 KB 的入口包）",
	owned > 0 && (lines.at(-1)?.[0] ?? 0) <= owned,
	`落定 ${lines.at(-1)?.[0]}ms vs React 接手 ${owned}ms`,
);
if (!REAL_HUB)
	check(
		"首次访问时那个早跑脚本的 /api/me 真的发出去了（这一项不是空跑）",
		titleProbeHits >= 1,
		`${titleProbeHits} 次`,
	);
if (!REAL_HUB)
	check(
		"首次访问的站名是那个早跑脚本贴的（走 fetch），不是等 React 写完才有的",
		(await probeSource()) === "fetch",
		`来源=${(await probeSource()) || "—"}`,
	);
// 只打印不判定：冷启动这里就是**两条** /api/me（早跑脚本一条 + React 一条）—— 刻意不合并，
// 理由见 public/nezha-title-probe.js 与 src/monitor/bridge.ts 里那段注释（合并会把首屏挂在
// 早跑脚本上，也拿掉下面「迟到的响应不许改标题」这条护栏的前提）。数字摆在这里，别再"顺手优化"。
console.log(
	`   冷启动的 /api/me：共 ${meHits} 条（其中早跑脚本 ${titleProbeHits} 条）`,
);
const probesAfterFirstVisit = titleProbeHits;

// 二、刷新：这次 localStorage 里已经有站名了，首帧就该是真站名——全程零跳变。
await send("Page.reload");
await sleep(SETTLE);
lines = await log();
owned = await ownedAt();
console.log(
	`\n刷新（有缓存）:\n${show(lines)}` + `\n    React 接手=${owned || "—"}ms`,
);
check(
	"刷新后末值 = 站名",
	lines.at(-1)?.[1] === SITE,
	`末值=${lines.at(-1)?.[1]}`,
);
// 刷新时那条占位值还在不在，取决于 5ms 采样有没有撞上「静态 <title> 已解析、那个 1KB 文件还没跑完」
// 那一瞬——本机常能看到，经 CF 的慢链路上通常连一次都采不到（首帧就已经是站名）。这是采样时机问题，
// 不是行为差异，所以只打印出来看看，不做断言；断言落在「记录条数」与「走的是哪条路」上。
console.log(
	`    刷新首帧观测到：${lines[0]?.[1] ?? "—"}（占位值=${lines[0]?.[1] === FALLBACK ? "是" : "没采到"}）`,
);
check(
	"刷新时最多两条记录（占位值活不过那个早跑脚本，没在等入口包）",
	lines.length <= 2,
	`${lines.length} 条记录：${lines.map(([, t]) => t).join(" → ")}`,
);
if (!REAL_HUB)
	check(
		"刷新走的是「贴缓存」那条路（缓存真的被用上了）",
		(await probeSource()) === "cache",
		`来源=${(await probeSource()) || "—"}`,
	);
if (!REAL_HUB)
	check(
		"刷新的站名落定在 React 接手之前",
		owned > 0 && (lines.at(-1)?.[0] ?? 0) <= owned,
		`落定 ${lines.at(-1)?.[0]}ms vs React 接手 ${owned}ms`,
	);
if (!REAL_HUB)
	check(
		"刷新时没有再问一次（缓存命中就不发那条请求了）",
		titleProbeHits === probesAfterFirstVisit,
		`首次访问后 ${probesAfterFirstVisit} 次 → 现在 ${titleProbeHits} 次`,
	);

if (REAL_HUB) {
	console.log(
		"\n（打真 hub：桩服务器的请求计数与「过期站名」都不适用，那两项已跳过）",
	);
	console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
	wsSendBin("Browser.close");
	chrome.kill();
	process.exit(fail ? 1 : 0);
}

// 三、清缓存 + 把那条早问的请求拖到 1.5s 之后，并让它回一个**过期站名**：
//    React 早就写好了真站名，那条迟到的若还去改标题，标题就会变成过期值——这里断言它没有（靠 window.__titleOwned）。
//    清缓存必须在**新文档的脚本跑之前**：React 会随手把缓存写回，在旧文档里 clear 会被它补上。
titleProbeStaleName = `过期站名-不应该出现`;
titleProbeDelay = 1500;
titleProbeHits = 0;
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: "try { localStorage.clear() } catch (e) {}",
});
await send("Page.navigate", { url: `${BASE}/` });
await sleep(6000);
lines = await log();
console.log(
	`\n清缓存 + 早问那条的响应迟到 1.5s（且带回一个过期站名）:\n${show(lines)}`,
);
check(
	"那条迟到的请求真的发出去了（这一项不是空跑）",
	titleProbeHits >= 1,
	`${titleProbeHits} 次`,
);
check(
	"迟到的响应没把标题改成过期值",
	lines.at(-1)?.[1] === SITE,
	`末值=${lines.at(-1)?.[1]}`,
);
check("过期值从没出现在标题里", !lines.some(([, t]) => t.includes("过期站名")));
check(
	"迟到的那次没再动标题（记录停在 React 那一次，没有第三条）",
	lines.length === 2 && lines.at(-1)?.[1] === SITE,
	`${lines.length} 条记录：${lines.map(([, t]) => t).join(" → ")}`,
);

console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
wsSendBin("Browser.close");
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
