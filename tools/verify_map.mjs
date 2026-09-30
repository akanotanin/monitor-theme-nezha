// 全球地图区块的验收：证明「地图那坨数据是按需加载的」+「渲染结果一字不差」。
//
// 用法: node tools/verify_map.mjs <本次快照.json> [基线快照.json]
//   不给基线：只跑断言并写出快照（第一次跑用它取基线）。
//   给了基线：再把渲染结果与基线逐字节比对 —— 这也是「改造前后地图没变样」的证据。
//
// 判据分两类：
//   ① 机制：点开地图**之前**，浏览器不该请求过地图那个异步 chunk（改造前这条必 FAIL——数据在入口包里）。
//   ② 结果：点了按钮之后，地图 SVG 的 path 数量 / 每一条 d / class / 命中圆的坐标 / 区块文案，与基线完全一致。
//
// 本机伺服 dist/ + 桩接口 + 桩 WebSocket（地图要有节点数据才会去渲染国家）。
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";

const OUT = process.argv[2] || `${process.env.TEMP || "."}/map-snapshot.json`;
const BASELINE = process.argv[3] || null;
const PORT = 5310;
const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

// 三个不同国家的节点：地图上要有「命中」的国家，tooltip 与高亮才会走到。
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
	last_seen: Math.floor(Date.now() / 1000),
	metrics: {
		cpu: 0.12,
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
	},
});
const NODES = {
	admin: false,
	nodes: [
		node(1, "节点一", "US"),
		node(2, "节点二", "JP"),
		node(3, "节点三", "DE"),
	],
};

const requested = [];
const server = createServer((req, res) => {
	const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
	requested.push(path);
	if (path.startsWith("/api/")) {
		let body = {};
		if (path === "/api/me") {
			body = {
				authed: false,
				github: false,
				public_page: true,
				site: "",
				site_name: "地图验收站",
			};
		} else if (path === "/api/nodes") {
			body = NODES;
		} else if (path.includes("/metrics")) {
			body = { metrics: [], probes: {}, loss: {}, ping: [] };
		}
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
	dbgPort = 9960 + Math.floor(Math.random() * 30);
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
				"/mapcheck-" +
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
	throw new Error("Chrome 起不来：先按 --user-data-dir 前缀清一遍测试实例");

let id = 0;
const pending = new Map();
const netRequests = [];
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
		netRequests.push(m.params.request.url);
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

// MAP_THROTTLE=<kbps>：模拟弱链路（手机 4G 之类），用来看「点开地图要等多久」。
const THROTTLE = Number(process.env.MAP_THROTTLE || 0);
if (THROTTLE) {
	await send("Network.emulateNetworkConditions", {
		offline: false,
		latency: 150,
		downloadThroughput: (THROTTLE * 1024) / 8,
		uploadThroughput: (THROTTLE * 1024) / 8,
	});
	console.log(`网络限速：${THROTTLE} kbps / 延迟 150ms`);
}

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
	if (ok) pass++;
	else fail++;
};

await send("Page.navigate", { url: `${BASE}/` });
const navAt = Date.now();

// 等节点数据渲染出来（WebSocket 帧推上去之后卡片才有内容）
let ready = false;
for (let i = 0; i < 300 && !ready; i++) {
	ready = Boolean(await js(`document.body.innerText.includes('节点一')`));
	if (!ready) await sleep(100);
}
const readyMs = Date.now() - navAt;
check(
	"页面拿到了节点数据（桩 WebSocket 生效）",
	ready,
	`首屏（列表出来）用了 ${readyMs}ms`,
);
check(
	"地图区块默认是收起的",
	(await js(
		`document.querySelectorAll('svg[viewBox="0 0 900 500"]').length`,
	)) === 0,
);

// ① 机制断言：点开地图之前，入口包里不该有地图数据，更不该有那次异步请求。
const chunkBefore = netRequests.filter((u) => /\.js(\?|$)/.test(u));
const jsBytesBefore = chunkBefore.length;
const lazyChunkBefore = chunkBefore.filter((u) =>
	/GlobalMap|geo|index\./.test(u),
);
const reqBefore = [...requested];
const bytesOf = (urls) =>
	urls.reduce((sum, p) => {
		const f = join("dist", p);
		return (
			sum + (existsSync(f) && !statSync(f).isDirectory() ? statSync(f).size : 0)
		);
	}, 0);
const firstLoadAssets = reqBefore.filter((p) => /\.(js|css)$/.test(p));
console.log(
	`点开地图之前的脚本 + 样式：${(bytesOf(firstLoadAssets) / 1024).toFixed(1)} KB raw / ${firstLoadAssets.length} 个文件`,
);
check(
	"点开之前没有请求过地图那个异步 chunk",
	!chunkBefore.some((u) => /GlobalMap/i.test(u)),
	`已请求 ${jsBytesBefore} 个脚本：${chunkBefore.map((u) => u.split("/").pop()).join(" ")}`,
);
check(
	"点开之前页面里没有 177 条世界轮廓的 path（数据没进入口包）",
	((await js(`document.querySelectorAll('path').length`)) ?? 0) < 50,
);
void lazyChunkBefore;

// ② 用户路径：点那个地图按钮（真鼠标事件，React 的合成事件不吃 el.click()）
const shot = async (name) => {
	const dir = process.env.MAP_SHOT_DIR;
	if (!dir) return;
	// 地图在页面底部，先滚到底再拍，不然截到的是上半屏的卡片
	await js(`window.scrollTo(0, document.body.scrollHeight)`);
	await sleep(200);
	const res = await send("Page.captureScreenshot", { format: "png" });
	if (res?.result?.data)
		writeFileSync(`${dir}/${name}`, Buffer.from(res.result.data, "base64"));
};
await shot("map-closed.png");
// ⚠️ 按钮坐标必须在截图（会滚动页面）之后再量，并且先 scrollIntoView ——
// 否则点的是「滚动前那个位置」，页面动了以后点在空白处，地图永远点不开。
const rect = await js(`(() => {
  const btn = document.querySelectorAll('.server-overview-controls section > button')[0]
  if (!btn) return null
  btn.scrollIntoView({ block: 'center' })
  const r = btn.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`);
check("找得到地图开关按钮", Boolean(rect));
// 骨架屏只存在几十到几百毫秒，靠 5ms 轮询把它的高度记下来（错过就是 -1）
await send("Runtime.evaluate", {
	expression: `window.__skel = -1
    const __t = setInterval(() => {
      const el = document.querySelector('.map-skeleton')
      if (el && window.__skel < 0) window.__skel = Math.round(el.getBoundingClientRect().height)
    }, 5)`,
});
const clickAt = Date.now();
if (rect) {
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: rect.x,
			y: rect.y,
			button: "left",
			clickCount: 1,
		});
	}
}
const skeletonH = await js(`(async () => {
  await new Promise((r) => setTimeout(r, 150))
  return window.__skel
})()`);

let drawn = 0;
for (let i = 0; i < 150 && drawn < 100; i++) {
	drawn =
		(await js(
			`document.querySelectorAll('svg[viewBox="0 0 900 500"] path').length`,
		)) ?? 0;
	if (drawn < 100) await sleep(200);
}
const drawnAt = Date.now();
check(
	"点开后地图画出来了",
	drawn > 100,
	`${drawn} 条 path，从点击到画好 ${drawnAt - clickAt}ms`,
);

const snapshot = await js(`JSON.stringify((() => {
  const svg = document.querySelector('svg[viewBox="0 0 900 500"]')
  const section = svg.closest('section')
  return {
    paths: [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')),
    classes: [...svg.querySelectorAll('path')].map((p) => p.getAttribute('class')),
    circles: [...svg.querySelectorAll('circle')].map((c) => [c.getAttribute('cx'), c.getAttribute('cy')]),
    text: section ? section.innerText.trim().split('\\n')[0] : null,
    mapPaths: svg.querySelectorAll('path').length,
    totalPaths: document.querySelectorAll('path').length,
    sectionHeight: section ? Math.round(section.getBoundingClientRect().height) : null,
    svgHeight: Math.round(svg.getBoundingClientRect().height),
  }
})())`);
const snap = JSON.parse(snapshot);
await shot("map-open.png");
console.log(
	`地图区块高度：骨架屏 ${skeletonH}px → 实际 ${snap.sectionHeight}px（svg ${snap.svgHeight}px，差额 ${Math.abs((snap.sectionHeight ?? 0) - skeletonH)}px）`,
);

const chunkAfter = netRequests.filter((u) => /\.js(\?|$)/.test(u));
check(
	"点开之后才出现地图那个异步 chunk",
	chunkAfter.length > chunkBefore.length,
	`新增：${chunkAfter
		.filter((u) => !chunkBefore.includes(u))
		.map((u) => u.split("/").pop())
		.join(" ")}`,
);
check(
	"区块文案里有地区数量",
	/(Regions|区域)/.test(snap.text ?? ""),
	`文案=${snap.text}`,
);

writeFileSync(OUT, `${JSON.stringify(snap, null, 1)}\n`);
console.log(
	`\n快照写入 ${OUT}（path ${snap.mapPaths} 条 / 命中圆 ${snap.circles.length} 个 / 全页 path ${snap.totalPaths} 条）`,
);

if (BASELINE) {
	const base = JSON.parse(readFileSync(BASELINE, "utf8"));
	check(
		"path 数量与基线一致",
		base.mapPaths === snap.mapPaths,
		`${base.mapPaths} → ${snap.mapPaths}`,
	);
	check("命中圆数量与基线一致", base.circles.length === snap.circles.length);
	check(
		"命中圆坐标与基线一致",
		JSON.stringify(base.circles) === JSON.stringify(snap.circles),
	);
	check(
		"区块文案与基线一致",
		base.text === snap.text,
		`${base.text} / ${snap.text}`,
	);
	const sameD =
		base.paths.length === snap.paths.length &&
		base.paths.every((d, i) => d === snap.paths[i]);
	check("每一条 path 的 d 与基线逐字节一致", sameD);
	const sameClass =
		base.classes.length === snap.classes.length &&
		base.classes.every((c, i) => c === snap.classes[i]);
	check("每一条 path 的 class（高亮态）与基线逐字节一致", sameClass);
	if (!sameD) {
		for (let i = 0; i < Math.max(base.paths.length, snap.paths.length); i++) {
			if (base.paths[i] !== snap.paths[i]) {
				console.log(
					`  第 ${i} 条不同：\n    基线 ${String(base.paths[i]).slice(0, 120)}\n    本次 ${String(snap.paths[i]).slice(0, 120)}`,
				);
				break;
			}
		}
	}
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
chrome?.kill();
wss.close();
server.close();
process.exit(fail ? 1 : 0);
