// 生成 README / 面板用的预览图：本机伺服 dist/ + 桩 /api + 桩 WebSocket，跑真渲染再截图。
//
// 用法：node tools/make_preview.mjs            （需先 npm run build，dist/ 必须是最新的）
//       node tools/make_preview.mjs <输出目录>  （默认 docs）
//
// 产出：<输出目录>/preview-home.png     首页（卡片视图、浅色、8 台，整页）
//       <输出目录>/preview-inline.png   首页（紧凑列表）
//       <输出目录>/preview-features.png 全球地图 + 延迟监控 + 周期流量（裁剪那一段）
//       <输出目录>/preview-detail.png   节点详情（含备注小卡片）
//       <输出目录>/preview-dark.png     首页（深色）
//       <输出目录>/preview-mobile.png   首页（手机 390×844 @2x）
//       preview.png                     面板缩略图（16:10，取自首页）
//       shots/preview-*.png             整页留档（shots/ 不入库）
//
// ★演示数据是**虚构的**，别换成真站数据：面板缩略图与 README 都会被别人看到。
// ★桩里的 WebSocket 必须真的握手：只桩 /api 的话页头会挂一条「实时连接中断」提示条，
//   那张图拿去交付等于把「桩不全」当成了主题的样子（见技能 monitor-theme-porting）。
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";

const OUT = process.argv[2] || "docs";
const PORT = 5399;
const CDP_PORT = 9899;
mkdirSync(OUT, { recursive: true });

const GB = 1024 ** 3;
const nowSec = () => Math.floor(Date.now() / 1000);

// ── 演示节点（全部虚构：城市名 + 常见机房配置） ──────────────────────────
const spec = (
	id,
	name,
	group,
	country,
	os,
	arch,
	cpuName,
	cores,
	memGB,
	diskGB,
	price,
	cycle,
	expiresAt,
	expiresIn,
	trafficGB,
	usedGB,
	cpu,
	load,
) => ({
	id,
	name,
	group,
	country,
	os,
	arch,
	kernel: "6.1.0-28-cloud-amd64",
	cpu_name: cpuName,
	cpu_cores: cores,
	virt: "kvm",
	online: true,
	public: true,
	sort: id,
	last_seen: nowSec() - 6,
	agent_version: "1.3.2",
	expires_at: expiresAt,
	expires_in: expiresIn,
	billing_cycle: cycle,
	price,
	currency: price >= 100 ? "CNY" : "USD",
	traffic_limit: trafficGB * GB,
	traffic_mode: "sum",
	traffic_reset_day: 1,
	total_rx: usedGB * GB * 22,
	total_tx: usedGB * GB * 6,
	month_rx: usedGB * GB * 0.8,
	month_tx: usedGB * GB * 0.2,
	month_used: usedGB * GB,
	month_start: "2026-10-01",
	day_rx: 6 * GB,
	day_tx: 2 * GB,
	metrics: {
		cpu,
		mem_used: Math.round(memGB * GB * (0.32 + cpu / 400)),
		mem_total: memGB * GB,
		swap_used: 0,
		swap_total: 0,
		disk_used: Math.round(diskGB * GB * (0.18 + ((id * 0.09) % 0.55))),
		disk_total: diskGB * GB,
		net_rx: 384 * 1024 + id * 97 * 1024,
		net_tx: 96 * 1024 + id * 31 * 1024,
		load,
		procs: 78 + id * 3,
		tcp: 24 + id,
		udp: 3,
		uptime: 1_100_000 + id * 86_400,
	},
});

const NODES = [
	spec(
		1,
		"东京",
		"亚太",
		"JP",
		"Debian GNU/Linux 12 (bookworm)",
		"x86_64",
		"AMD EPYC 7B13",
		2,
		2,
		40,
		12.5,
		"monthly",
		"2027-01-05",
		92,
		500,
		168,
		26.4,
		[0.32, 0.41, 0.38],
	),
	spec(
		2,
		"大阪",
		"亚太",
		"JP",
		"Ubuntu 24.04 LTS (noble)",
		"x86_64",
		"AMD Ryzen 9 7950X",
		4,
		8,
		80,
		25,
		"monthly",
		"2026-12-18",
		74,
		1024,
		402,
		41.8,
		[0.72, 0.65, 0.61],
	),
	spec(
		3,
		"新加坡",
		"亚太",
		"SG",
		"AlmaLinux 9.5 (Sage Margay)",
		"x86_64",
		"Intel Xeon Platinum 8488C",
		2,
		4,
		60,
		6.5,
		"monthly",
		"2027-03-01",
		147,
		1024,
		236,
		18.2,
		[0.18, 0.22, 0.2],
	),
	spec(
		4,
		"香港",
		"亚太",
		"HK",
		"Alpine Linux 3.20",
		"x86_64",
		"Intel Xeon E5-2680 v4",
		1,
		1,
		20,
		18,
		"monthly",
		"2026-11-30",
		56,
		200,
		121,
		55.3,
		[0.95, 0.88, 0.79],
	),
	spec(
		5,
		"圣何塞",
		"欧美",
		"US",
		"Debian GNU/Linux 12 (bookworm)",
		"x86_64",
		"AMD EPYC 9354",
		2,
		4,
		60,
		349,
		"yearly",
		"2027-07-21",
		292,
		2000,
		640,
		12.7,
		[0.11, 0.14, 0.16],
	),
	spec(
		6,
		"洛杉矶",
		"欧美",
		"US",
		"Debian GNU/Linux 13 (trixie)",
		"x86_64",
		"AMD Ryzen 7 7700",
		6,
		16,
		200,
		144,
		"yearly",
		"2028-02-09",
		128,
		4000,
		1180,
		33.9,
		[0.55, 0.6, 0.52],
	),
	spec(
		7,
		"伦敦",
		"欧美",
		"GB",
		"Rocky Linux 9.5 (Blue Onyx)",
		"x86_64",
		"Intel Xeon Gold 6338",
		2,
		4,
		60,
		3,
		"monthly",
		"2027-04-12",
		189,
		1024,
		88,
		21.5,
		[0.24, 0.27, 0.31],
	),
	spec(
		8,
		"法兰克福",
		"欧美",
		"DE",
		"Debian GNU/Linux 12 (bookworm)",
		"x86_64",
		"AMD EPYC 7543",
		2,
		4,
		40,
		5.5,
		"monthly",
		"2026-12-02",
		58,
		500,
		74,
		15.6,
		[0.2, 0.24, 0.19],
	),
];

// 备注：全部在线 —— 离线卡片与在线卡片不是同一套版式（见 ServerCard 的 online 分支），
// 混在一张预览图里会被看成「这张卡没加载出来」。

// 备注：① 主题设置的「标签规则」没匹配到的机器，卡片底部改用 hub 的「公开备注」；
//       ② 私有备注只在登录态下发，这里为了拍「整页详情」那张图带上一台。
const PLAN_TAGS = [
	"东京 = CN2 GIA,IPv4,IPv6",
	"大阪 = 500Mbps,IPv4",
	"新加坡 = 1Gbps,IPv4,IPv6",
	"香港 = 100Mbps,IPv4,IPv6",
	"圣何塞 = 1Gbps,IPv4",
	"洛杉矶 = 2.5Gbps,IPv4,IPv6",
	"伦敦 = 1Gbps,IPv4,IPv6",
].join("\n");
const PUBLIC_REMARKS = { 1: "原生 IP,CN2 回程", 8: "欧洲原生 IP,大盘鸡" };
const PRIVATE_REMARKS = {
	1: "续费到 2027-01-05，别再忘了\n面板 https://panel.example.com",
};

// ── 桩数据 ────────────────────────────────────────────────────────────────
const PROBES = { 1: "北京电信", 2: "北京联通", 3: "北京移动" };
const jitter = (seed, spread) =>
	Math.sin(seed * 12.9898) * spread + Math.cos(seed * 78.233) * (spread / 2);

/** ping 历史：三条探测线路，`loss` 表示该线路整个窗口的丢包率。 */
function pingSeries(nodeId, hours) {
	const step = hours <= 24 ? 300 : hours <= 168 ? 3600 : 21600;
	const from = nowSec() - hours * 3600;
	const ping = [];
	for (let ts = from; ts <= nowSec(); ts += step) {
		for (const taskId of [1, 2, 3]) {
			const base = 26 + nodeId * 9 + taskId * 6;
			const day = Math.floor(ts / 86400);
			// 每天留一点波动，个别采样点丢包（latency = -1 就是丢包）
			const lost = (day * 7 + taskId * 3 + nodeId) % 61 === 0;
			ping.push({
				task_id: taskId,
				latency: lost
					? -1
					: Number((base + jitter(ts / 600 + taskId, 14)).toFixed(1)),
				ts,
			});
		}
	}
	return { ping, probes: PROBES, loss: { 1: 0.3, 2: 0, 3: 1.1 } };
}

/** 指标历史：cpu / mem_used / disk_used / net_rx / net_tx（详情页那几条曲线）。 */
function metricsSeries(nodeId, hours) {
	const step = hours <= 24 ? 300 : hours <= 168 ? 900 : 7200;
	const from = nowSec() - hours * 3600;
	const node = NODES.find((n) => n.id === nodeId) ?? NODES[0];
	const metrics = [];
	for (let ts = from; ts <= nowSec(); ts += step) {
		const wave = Math.sin((ts / 3600) * 1.7 + nodeId) * 9 + jitter(ts / 900, 6);
		metrics.push({
			ts,
			cpu: Number(
				Math.max(2, Math.min(96, node.metrics.cpu + wave)).toFixed(1),
			),
			mem_used: Math.max(
				0,
				node.metrics.mem_used +
					jitter(ts / 1200, node.metrics.mem_total * 0.04),
			),
			disk_used: node.metrics.disk_used + ((ts - from) / 3600) * 1024 * 8,
			net_rx: Math.max(
				1024,
				node.metrics.net_rx + jitter(ts / 700, 220 * 1024),
			),
			net_tx: Math.max(1024, node.metrics.net_tx + jitter(ts / 500, 90 * 1024)),
		});
	}
	return { metrics };
}

let preset = "default";
const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
};

const server = createServer((req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	const path = url.pathname;
	if (path.startsWith("/api/")) {
		let body = {};
		if (path === "/api/me") {
			// ★演示数据里带**私有备注**（只有登录的管理员拿得到），所以页头也得是登录态 ——
			// 否则图上会出现「写着『登录』却看得见仅自己可见的备注」这种自相矛盾。
			// 上游判断登录看的是「id 非 0」且 `document.cookie` 非空，所以这条得带个 cookie。
			res.setHeader("Set-Cookie", "nezha_token=preview; Path=/; SameSite=Lax");
			body = {
				authed: true,
				github: "akanotanin",
				public_page: true,
				site: "",
				site_name: "Monitor Nezha",
				history_days: 30,
			};
		} else if (path === "/api/nodes") {
			body = {
				admin: false,
				nodes: NODES.map((n) => ({
					...n,
					public_remark: PUBLIC_REMARKS[n.id] ?? "",
					remark: PRIVATE_REMARKS[n.id] ?? "",
				})),
			};
		} else if (path.endsWith("/config")) {
			body = {
				planTags: PLAN_TAGS,
				remarkPlacement: "both",
				language: "zh-CN",
				forceCardInline: false,
				forceShowMap: preset === "expanded",
				forceShowServices: preset === "expanded",
			};
		} else if (path === "/api/version") {
			body = { version: "1.3.2" };
		} else if (/^\/api\/nodes\/\d+\/metrics/.test(path)) {
			const id = Number(path.split("/")[3]);
			const hours = Number(url.searchParams.get("hours") ?? 720);
			const series = url.searchParams.get("series");
			body =
				series === "ping"
					? pingSeries(id, hours)
					: series === "metrics"
						? metricsSeries(id, hours)
						: { ...metricsSeries(id, hours), ...pingSeries(id, hours) };
		}
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		return res.end(JSON.stringify(body));
	}
	const file = path === "/" ? "/index.html" : path;
	const full = join("dist", normalize(file).replace(/^(\.\/)+/, ""));
	if (!existsSync(full) || statSync(full).isDirectory()) {
		res.writeHead(200, {
			"Content-Type": TYPES[".html"],
			"Cache-Control": "no-store",
		});
		return res.end(readFileSync("dist/index.html"));
	}
	res.writeHead(200, {
		"Content-Type": TYPES[extname(full)] ?? "application/octet-stream",
		"Cache-Control": "no-store",
	});
	res.end(readFileSync(full));
});
const wss = new WebSocketServer({ server, path: "/api/ws" });
wss.on("connection", (socket) => {
	const push = () =>
		socket.readyState === 1 &&
		socket.send(
			JSON.stringify({
				admin: false,
				nodes: NODES.map((n) => ({
					...n,
					public_remark: PUBLIC_REMARKS[n.id] ?? "",
					remark: PRIVATE_REMARKS[n.id] ?? "",
				})),
			}),
		);
	push();
	const timer = setInterval(push, 3000);
	socket.on("close", () => clearInterval(timer));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`dist/ 伺服在 ${BASE}/`);

// ── 浏览器 ────────────────────────────────────────────────────────────────
const CHROME =
	[
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
		"/usr/bin/google-chrome",
	].find((p) => existsSync(p)) || "chrome";
const chrome = spawn(
	CHROME,
	[
		"--headless=new",
		`--remote-debugging-port=${CDP_PORT}`,
		"--remote-allow-origins=*",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-gpu",
		"--hide-scrollbars",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--force-color-profile=srgb",
		"--font-render-hinting=none",
		"--no-proxy-server",
		`--user-data-dir=${join(tmpdir(), `nzpreview${CDP_PORT}-${Date.now()}`)}`,
		"--window-size=1600,1000",
		"about:blank",
	],
	{ stdio: "ignore" },
);

let target = null;
for (let i = 0; i < 100 && !target; i++) {
	await sleep(300);
	try {
		target = (
			await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
		).find((t) => t.type === "page");
	} catch {
		/* 等 Chrome 起来 */
	}
}
if (!target)
	throw new Error("Chrome 没起来：先按 --user-data-dir 前缀清一遍测试实例");

const socket = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
socket.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
	}
});
const send = (method, params = {}) =>
	new Promise((resolve) => {
		const id = ++msgId;
		pending.set(id, resolve);
		socket.send(JSON.stringify({ id, method, params }));
	});
await new Promise((r) => socket.addEventListener("open", r));
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

async function shot(name, clip, dir = OUT) {
	const params = { format: "png", fromSurface: true };
	if (clip) params.clip = clip;
	const res = await send("Page.captureScreenshot", params);
	const file = `${dir}/${name}.png`;
	writeFileSync(file, Buffer.from(res.result.data, "base64"));
	const size = statSync(file).size;
	console.log(`  ${file}  ${(size / 1024).toFixed(0)} KB`);
	return { file, size };
}

/** 页面条件满足了再拍：固定等待会拍到加载骨架，而骨架图体积正常、不报错。 */
async function waitFor(expr, label, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	let ok = false;
	while (Date.now() < deadline && !ok) {
		ok = (await js(`!!(${expr})`)) === true;
		if (!ok) await sleep(300);
	}
	if (!ok) throw new Error(`等不到「${label}」：${expr}`);
	await js("document.fonts.ready.then(() => true)");
	await sleep(700);
}

const ALL_NAMES = JSON.stringify(NODES.map((n) => n.name));
const HOME_READY = `${ALL_NAMES}.every((n) => document.body.innerText.includes(n))`;
const DETAIL_READY =
	"document.querySelectorAll('.recharts-surface').length > 0";
const MAP_READY =
	"document.querySelectorAll('svg[viewBox=\"0 0 900 500\"] path').length > 100";

async function viewport(width, height, dpr, mobile) {
	await send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: dpr,
		mobile,
	});
}
async function goto(url) {
	await send("Page.navigate", { url });
}
const setLocal = async (entries) => {
	await js(
		`(() => { const e = ${JSON.stringify(entries)}; for (const k of Object.keys(e)) { if (e[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, e[k]); } return true })()`,
	);
};

/** 视口高度贴合内容：写死的视口会把最后一行卡片裁掉，拍出来像「主题少了一块」。 */
async function fitHeight(width, dpr, mobile, cap = 2600) {
	const height = await js(
		`Math.round(Math.min(${cap}, Math.max(700, document.documentElement.scrollHeight)))`,
	);
	await viewport(width, height, dpr, mobile);
	await sleep(600);
	console.log(`  视口 ${width}×${height}`);
}

/** 用真鼠标事件点一个按钮（React 的合成事件不吃 el.click()）。 */
async function clickText(text) {
	// 挑「文字完全相等且子元素最少」的那个节点，否则会点到外层容器（见技能 monitor-theme-porting）。
	const rect = await js(`(() => {
    const all = [...document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"], label, span, div')]
    const cands = all.filter((n) => (n.innerText || '').trim() === ${JSON.stringify(text)})
    if (!cands.length) return null
    cands.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
    const el = cands[0]
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, kids: el.querySelectorAll('*').length }
  })()`);
	if (!rect) {
		const seen = await js(
			`[...new Set([...document.querySelectorAll('button, [role="tab"], [role="radio"]')].map((n) => (n.innerText || '').trim()).filter(Boolean))].slice(0, 40).join(' | ')`,
		);
		throw new Error(`找不到按钮「${text}」；页面上可点的文字有：${seen}`);
	}
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: rect.x,
			y: rect.y,
			button: "left",
			clickCount: 1,
		});
	}
	await sleep(900);
}

console.log("① 首页（卡片视图、浅色）");
await setLocal({
	inline: null,
	"vite-ui-theme": "light",
	language: "zh-CN",
	showMap: null,
	showServices: null,
});
await viewport(1600, 1000, 1, false);
await goto(`${BASE}/`);
await waitFor(HOME_READY, "八台机器都渲染出来");
await fitHeight(1600, 1, false);
await shot("preview-home");
// 面板缩略图那张单独拍 16:10 的（与旧 preview.png 同比例）：整页图太窄长，当缩略图不好看。
await viewport(1600, 1000, 1, false);
await sleep(600);
const thumb = await shot("preview-thumb", null, "shots");
// 核对末位卡片（法兰克福，走 hub「公开备注」那条路）底部那排芯片的文字：
// 视觉模型读小字不可靠，用 DOM 兜一遍。
const chipText = await js(`(() => {
  const els = [...document.querySelectorAll('*')].filter((n) => /大盘鸡|欧洲原生/.test(n.innerText || ''))
  return els.length ? els[els.length - 1].innerText.replace(/\\n/g, ' / ') : '（没找到 大盘鸡 / 欧洲原生）'
})()`);
console.log(`  法兰克福卡片底部芯片：${chipText}`);

console.log("② 首页（紧凑列表）");
await setLocal({ inline: "1" });
await send("Page.reload");
await waitFor(HOME_READY, "紧凑列表渲染出来");
await fitHeight(1600, 1, false);
await shot("preview-inline");

console.log("③ 首页（全球地图 + 延迟监控展开）");
preset = "expanded";
await setLocal({ inline: null });
await goto(`${BASE}/`);
await waitFor(MAP_READY, "地图画出来", 40000);
await waitFor(
	"document.body.innerText.includes('在线率')",
	"延迟监控画出来",
	40000,
);
await fitHeight(1600, 1, false);
await shot("preview-features-full", null, "shots");
// 地图 + 延迟监控那一段单独裁一张给 README：整页 2500px 太高，放进 README 会占掉半屏。
const clip = await js(`(() => {
  window.scrollTo(0, 0)
  const map = document.querySelector('svg[viewBox="0 0 900 500"]')?.closest('section')
  const tracker = [...document.querySelectorAll('div.mt-4.w-full.mx-auto')].pop()
  if (!map || !tracker) return null
  const a = map.getBoundingClientRect()
  const b = tracker.getBoundingClientRect()
  const y = Math.max(0, Math.round(a.top + window.scrollY - 28))
  return { x: 0, y, width: 1600, height: Math.min(1900, Math.round(b.bottom + window.scrollY - y + 28)), scale: 1 }
})()`);
if (!clip) throw new Error("找不到地图 / 延迟监控区块");
console.log(`  裁剪 ${JSON.stringify(clip)}`);
await shot("preview-features", clip);
preset = "default";

console.log("④ 节点详情（含备注小卡片）");
await viewport(1600, 1100, 1, false);
await goto(`${BASE}/server/1`);
await waitFor(DETAIL_READY, "详情页曲线画出来");
await clickText("1 天"); // 默认「实时」只有一个采样点，曲线是空的
await sleep(1200);
await fitHeight(1600, 1, false);
await shot("preview-detail");

console.log("⑤ 首页（深色）");
await setLocal({ "vite-ui-theme": "dark" });
await viewport(1600, 1000, 1, false);
await goto(`${BASE}/`);
await waitFor(HOME_READY, "深色首页渲染出来");
await fitHeight(1600, 1, false);
await shot("preview-dark");

console.log("⑥ 首页（手机 390×844 @2x）");
await setLocal({ "vite-ui-theme": "light" });
await viewport(390, 844, 2, true);
await goto(`${BASE}/`);
await waitFor(HOME_READY, "手机首页渲染出来");
await sleep(600);
await shot("preview-mobile");

// 面板缩略图用那张 16:10 的
writeFileSync("preview.png", readFileSync(thumb.file));
console.log(`preview.png ← ${thumb.file}`);

socket.close();
chrome.kill();
wss.close();
server.close();
process.exit(0);
