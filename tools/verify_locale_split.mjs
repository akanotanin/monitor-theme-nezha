// 词条按需加载的验收（入口包只带默认语言 + 兜底语言，其余 12 种拉 chunk）。
//
// 背景：14 份 translation.json 合计约 50KB（未压缩）原先全在入口包里，而访客一次只看一种语言。
// 改完之后要同时成立四件事：
//   ① 默认语言（站点设置 = 简体中文）的访客**一个词条 chunk 都不下**；
//   ② 页头切语言时先把那种词条拉进来再切（切完就是那种语言，不是先闪一下兜底语言）；
//   ③ 站点默认语言设成懒加载的那种（例：de-DE）时，词条在**首帧之前**就下好 ——
//      页面从头到尾没出现过兜底语言（en）的文案；
//   ④ 入口包（dist/index.html 引用的那些 js）里不含其它语言的词条（静态查，这是这条优化的本体）。
//
// 用法: node tools/verify_locale_split.mjs
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";

const PORT = 5360;
const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/manifest+json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".webp": "image/webp",
	".woff": "woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

const node = (id, name) => ({
	id,
	name,
	group: "默认",
	country: "JP",
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
const NODES = { admin: false, nodes: [node(1, "语言机 A")] };

/** 站点设置里的「站点默认语言」，每个场景换一次。 */
let configLanguage = "zh-CN";

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
				site_name: "词条验收站",
				history_days: 30,
			};
		else if (path === "/api/nodes") body = NODES;
		else if (path.endsWith("/config")) body = { language: configLanguage };
		else if (path.includes("/metrics"))
			body = { metrics: [], ping: [], probes: {}, loss: {} };
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

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
	if (ok) pass++;
	else fail++;
};

// ── ④ 先做静态那半：入口包里不该有其它语言的词条 ────────────────────────────
const firstLoadJs = [
	...readFileSync("dist/index.html", "utf8").matchAll(
		/assets\/[A-Za-z0-9_.@-]+\.js/g,
	),
].map((m) => m[0]);
const FOREIGN = ["Überblick", "概覽", "Обзор", "Vue d'ensemble"];
const hits = firstLoadJs.filter((file) => {
	const text = readFileSync(join("dist", file), "utf8");
	return FOREIGN.some((word) => text.includes(word));
});
console.log(
	`\n════ ④ 入口包静态查（${firstLoadJs.length} 个 js）════\n   查的词：${FOREIGN.join(" / ")}`,
);
check(
	"入口包里没有其它语言的词条（12 种都在各自的 chunk 里）",
	hits.length === 0,
	hits.length ? `命中：${hits.join(" ")}` : "",
);
const chunks = existsSync("dist/assets")
	? readFileSync("dist/index.html", "utf8").length && 0
	: 0;
void chunks;

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
	dbgPort = 9990 + Math.floor(Math.random() * 30);
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
			`--user-data-dir=${process.env.TEMP || "/tmp"}/locsplit-${dbgPort}-${Date.now()}`,
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

/** 词条 chunk 的请求（构建产物叫 translation.<hash>.js）。 */
const localeChunks = () =>
	requests.filter((u) => /translation\.[A-Za-z0-9_-]+\.js/.test(u));

async function waitFor(expr, label, timeoutMs = 25000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ((await js(`!!(${expr})`)) === true) return;
		await sleep(150);
	}
	throw new Error(`等不到「${label}」：${expr}`);
}
const bodyText = async () => String(await js("document.body.innerText"));
const htmlLang = async () => String(await js("document.documentElement.lang"));

// ── ① 站点默认语言 = 简体中文（在包里）→ 不该下任何词条 chunk ───────────────
console.log("\n════ ① 默认语言 简体中文（在包里）════");
configLanguage = "zh-CN";
requests.length = 0;
await send("Page.navigate", { url: `${BASE}/` });
await waitFor("document.body.innerText.includes('语言机 A')", "节点列表出来");
await sleep(2500);
const text1 = await bodyText();
check("页面渲染出来了", text1.includes("语言机 A"));
check(
	"界面是简体中文（概览）",
	text1.includes("概览"),
	text1.slice(0, 40).replace(/\n/g, " "),
);
check(
	"一个词条 chunk 都没下（默认语言在包里）",
	localeChunks().length === 0,
	`${localeChunks().length} 个：${localeChunks()
		.map((u) => u.split("/").pop())
		.join(" ")}`,
);
check("<html lang> = zh-CN", (await htmlLang()) === "zh-CN", await htmlLang());

// ── ② 页头切到 繁體中文（懒加载）→ 该下 chunk，且切完就是繁体 ───────────────
console.log("\n════ ② 页头切到 繁體中文（懒加载）════");
requests.length = 0;
const opened = await js(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Change language/.test(b.innerText))
  if (!btn) return false
  const r = btn.getBoundingClientRect()
  window.__langBtn = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  return true
})()`);
check("找得到语言切换按钮", Boolean(opened));
if (opened) {
	const p = await js("window.__langBtn");
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: p.x,
			y: p.y,
			button: "left",
			clickCount: 1,
			pointerType: "mouse",
		});
	}
	await sleep(600);
	// 菜单项的文字来自各语言自己的词条：简体中文下这一项写作「繁體中文」。
	const item = await js(`(() => {
    const el = [...document.querySelectorAll('[role="menuitem"]')].find((n) => n.innerText.trim() === '繁體中文')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`);
	check("语言菜单里有「繁體中文」", Boolean(item));
	if (item) {
		for (const type of ["mousePressed", "mouseReleased"]) {
			await send("Input.dispatchMouseEvent", {
				type,
				x: item.x,
				y: item.y,
				button: "left",
				clickCount: 1,
				pointerType: "mouse",
			});
		}
		let switched = false;
		for (let i = 0; i < 30 && !switched; i++) {
			switched = (await bodyText()).includes("概覽");
			if (!switched) await sleep(200);
		}
		check("切完界面就是繁體（概覽）", switched);
		check(
			"切换时下了那一种词条 chunk",
			localeChunks().length === 1,
			`${localeChunks()
				.map((u) => u.split("/").pop())
				.join(" ")}`,
		);
		check(
			"<html lang> = zh-TW",
			(await htmlLang()) === "zh-TW",
			await htmlLang(),
		);
	}
}

// ── ③ 站点默认语言 = de-DE（懒加载）+ 干净 profile → 首帧之前就该下好 ────────
console.log("\n════ ③ 站点默认语言 de-DE：不能先闪一下兜底语言 ════");
configLanguage = "de-DE";
await js("localStorage.clear()");
// 装一个观察器：记录页面文本里出现过哪些「概览」写法（en / de）。
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: `window.__langSeen = { en: false, de: false };
    document.addEventListener('DOMContentLoaded', () => {
      const scan = () => {
        const t = document.body ? document.body.innerText : '';
        if (/Overview/.test(t)) window.__langSeen.en = true;
        if (/Überblick/.test(t)) window.__langSeen.de = true;
      };
      scan();
      new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });`,
});
requests.length = 0;
await send("Page.navigate", { url: `${BASE}/` });
await waitFor("document.body.innerText.includes('语言机 A')", "节点列表出来");
await sleep(2500);
const text3 = await bodyText();
check(
	"界面是德语（Überblick）",
	text3.includes("Überblick"),
	text3.slice(0, 40).replace(/\n/g, " "),
);
check("<html lang> = de-DE", (await htmlLang()) === "de-DE", await htmlLang());
check(
	"冷启动下了 de-DE 那一种词条 chunk",
	localeChunks().length === 1,
	`${localeChunks()
		.map((u) => u.split("/").pop())
		.join(" ")}`,
);
const seen = await js("JSON.stringify(window.__langSeen)");
console.log(`   首帧观察器：${seen}`);
check(
	"全程没出现过兜底语言（en）的文案 —— 词条是首帧之前就下好的",
	!/"en":true/.test(String(seen)),
	String(seen),
);

console.log(`\n${pass} PASS / ${fail} FAIL`);
chrome?.kill();
wss.close();
server.close();
process.exit(fail ? 1 : 0);
