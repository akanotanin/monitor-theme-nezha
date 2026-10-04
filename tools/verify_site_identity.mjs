// 「站点身份」的验收：站名（标签页标题 / iOS 主屏名 / PWA 清单名）与站点图标
// （customLogo → 顶栏 + 标签页 + iOS 主屏 + 清单 icons）到底有没有传到该到的地方。
//
// 用法: node tools/verify_site_identity.mjs [站名]
//   本机伺服 dist/ + 桩接口，跑三个场景：
//     ① 冷启动（没有缓存）：图标最终要对，并且要把成功那张记进缓存；
//     ② 返访（有缓存）：**标签页图标从第一条记录起就是站长那张**（不闪主题自带图），
//        主题自带那张一次都不下；
//     ③ 站长设的图标取不到（404）：顶栏与标签页都退回主题自带那张，且不许把坏地址记进缓存。
//
// 判据落在两处：浏览器真正解析到的 DOM/清单（manifest 换成 blob 地址也照样验）+ 网络层下了哪些地址。
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SITE_NAME = process.argv[2] || "测试の探针站";
const LOGO = "/logo-test.png"; // 桩「站长设的图标」：与主题自带那张不同的地址
const BROKEN = "/logo-missing.png"; // 桩：站长填错地址 / 那张图挂了
const FALLBACK = "/favicon.svg"; // 主题自带那张
const PORT = 5320;
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

// 1×1 的 PNG：桩图标只要能解码就行，断言看的是「请求了哪个地址」
const PNG_1PX = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

const node = (id, name) => ({
	id,
	name,
	group: "默认",
	country: "JP",
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
	nodes: [node(1, "测试机 A"), node(2, "测试机 B")],
};

/** 主题设置：只设「站点 Logo」，站名走 /api/me。场景之间会改。 */
let themeConfig = { customLogo: LOGO };

const server = createServer((req, res) => {
	const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
	if (path === LOGO) {
		// 像 hub 伺服静态文件那样可缓存：同一地址第二次用到时应当是缓存命中
		res.writeHead(200, {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=300",
		});
		return res.end(PNG_1PX);
	}
	if (path.startsWith("/api/")) {
		let body = {};
		if (path === "/api/me") {
			body = {
				authed: false,
				github: false,
				public_page: true,
				site: "",
				site_name: SITE_NAME,
			};
		} else if (path === "/api/nodes") {
			body = NODES;
		} else if (path.endsWith("/config")) {
			body = themeConfig;
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
	// 静态文件一律不缓存：「主题自带那张被下了几次」才是真的网络请求数，不被缓存掩盖
	res.writeHead(200, {
		"Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
		"Cache-Control": "no-store",
	});
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`dist/ 伺服在 ${BASE}/   站名=${SITE_NAME}   站点图标=${LOGO}`);

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
			"--user-data-dir=" +
				(process.env.TEMP || "/tmp") +
				"/idcheck-" +
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
let netRequests = [];
const servedFromCache = new Set();
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
	if (m.method === "Network.requestWillBeSent") {
		netRequests.push({
			id: m.params.requestId,
			url: m.params.request.url,
			type: m.params.type,
			wall: m.params.wallTime * 1000,
			initiator: m.params.initiator,
			// 图标这类请求要看清「谁发起的」：HTML 解析器发的、还是某个 link/脚本发的
			from: (() => {
				const i = m.params.initiator || {};
				const stack = (i.stack?.callFrames ?? [])
					.map((f) => `${f.url.split("/").pop()}:${f.lineNumber}`)
					.join(" < ");
				return `${i.type}${i.url ? ` ${i.url.replace(BASE, "")}` : ""}${stack ? ` [${stack}]` : ""}`;
			})(),
		});
	}
	if (m.method === "Network.requestServedFromCache")
		servedFromCache.add(m.params.requestId);
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

// SITE_THROTTLE=<kbps>：模拟弱链路（手机 4G 之类）。用来验 jashisei 那个坑 ——
// 同一个图标地址被页头 <img> 与标签页并发拉两条时，弱链路上会不会把页头那张拉挂。
const THROTTLE = Number(process.env.SITE_THROTTLE || 0);
if (THROTTLE) {
	await send("Network.emulateNetworkConditions", {
		offline: false,
		latency: 150,
		downloadThroughput: (THROTTLE * 1024) / 8,
		uploadThroughput: (THROTTLE * 1024) / 8,
	});
	console.log(`网络限速：${THROTTLE} kbps / 延迟 150ms`);
}

// 文档一建好就装上记录器：5ms 轮一次「标签页图标那张 link」，变了就记一条。
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: `window.__iconLog = []
    window.__iconLogRaw = []
    let __last = null
    setInterval(() => {
      const links = [...document.querySelectorAll('link[rel]')].filter((l) => (l.getAttribute('rel') || '').split(/\\s+/).includes('icon'))
      window.__iconLogRaw = links.map((l) => ({ rel: l.rel, type: l.getAttribute('type') || '', href: l.getAttribute('href') }))
      const sig = JSON.stringify(window.__iconLogRaw)
      if (sig !== __last) { __last = sig; window.__iconLog.push([Math.round(performance.now()), sig]) }
      // React 什么时候接手的（Header 写标题前会置这个标志）—— 用来判断标签页图标
      // 是那个早跑脚本贴上的，还是等入口包跑完才贴的。
      if (window.__titleOwned && !window.__ownedAt) window.__ownedAt = Math.round(performance.now())
    }, 5)`,
});

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
	if (ok) pass++;
	else fail++;
};
const warn = (msg) => console.log(`  · ${msg}`);

const EXPECTED_MIME = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
};
const mimeOk = (href, type) => {
	if (!type) return true; // 不写 type 让浏览器自己嗅探，合法且最稳
	const clean = String(href || "").split(/[?#]/)[0];
	const ext = clean.slice(clean.lastIndexOf(".")).toLowerCase();
	return EXPECTED_MIME[ext] ? type === EXPECTED_MIME[ext] : true;
};

/** 跑一个场景：导航 → 等页面安静 → 抓 DOM / 浏览器解析到的清单 / 网络层。 */
async function scenario(name, { seeded, expectIcon }) {
	const navAt = Date.now();
	netRequests = [];
	await send("Page.navigate", { url: `${BASE}/` });
	// 等「页面真的跑起来」再采样：React 接手（window.__titleOwned）+ 顶栏那张图有结果。
	// 固定 sleep 在弱链路下会采到「还没加载完」，把没加载当成加载错（实测 500kbps 下 4.5s 远不够）。
	let settled = false;
	for (let i = 0; i < 250 && !settled; i++) {
		settled = Boolean(
			await js(`(() => {
        const img = document.querySelector('.header-logo img')
        return Boolean(window.__titleOwned && img && img.complete)
      })()`),
		);
		if (!settled) await sleep(200);
	}
	await sleep(500); // 让清单重写、缓存写入这些尾巴跑完
	console.log(
		`   （页面就绪耗时 ${Date.now() - navAt}ms${settled ? "" : " —— 超时未就绪！"}）`,
	);

	const state = {
		title: await js(`document.title`),
		metaTitle: await js(
			`(document.querySelector('meta[name="apple-mobile-web-app-title"]') || {}).content || ''`,
		),
		appleIcon: await js(
			`(document.querySelector('link[rel="apple-touch-icon"]') || {}).getAttribute?.('href') || ''`,
		),
		imgSrc: await js(
			`(document.querySelector('.header-logo img') || {}).getAttribute?.('src') || ''`,
		),
		imgOk: await js(
			`(() => { const i = document.querySelector('.header-logo img'); return i ? (i.complete && i.naturalWidth > 0) : false })()`,
		),
		iconLinks: JSON.parse(
			await js(`JSON.stringify(window.__iconLogRaw || [])`),
		),
		iconLog: JSON.parse(await js(`JSON.stringify(window.__iconLog || [])`)),
		ownedAt: Number(await js(`window.__ownedAt || 0`)),
		cache: await js(`(localStorage.getItem('nezha:site_icon') || '')`),
		manifestHref: await js(
			`(document.querySelector('link[rel="manifest"]') || {}).getAttribute?.('href') || ''`,
		),
	};
	const appManifest = await send("Page.getAppManifest");
	try {
		state.mf = JSON.parse(appManifest.result?.data ?? "null");
	} catch {
		state.mf = null;
	}
	state.mfError = (appManifest.result?.errors ?? [])
		.map((e) => e.message)
		.join("; ");

	const reqs = netRequests.filter((r) =>
		/favicon|logo-test|logo-missing|apple-touch-icon|android-chrome|manifest\.json/.test(
			r.url,
		),
	);
	const isNet = (r) => !servedFromCache.has(r.id);
	state.netHits = (kw) =>
		reqs.filter((r) => r.url.includes(kw) && isNet(r)).length;

	console.log(`\n════ 场景：${name} ════`);
	console.log("请求（带 [缓存命中] 的不占带宽）：");
	for (const r of reqs) {
		console.log(
			`   +${String(Math.round(r.wall - navAt)).padStart(5)}ms ${r.type.padEnd(7)} ${r.url.replace(BASE, "")}${isNet(r) ? "" : "   [缓存命中]"}\n        ← ${r.from}`,
		);
	}
	console.log(
		`DOM: title=${JSON.stringify(state.title)} | apple-title=${JSON.stringify(state.metaTitle)} | apple-touch-icon=${state.appleIcon} | manifest.href=${state.manifestHref.slice(0, 46)}`,
	);
	console.log(
		`清单: name=${JSON.stringify(state.mf?.name)} short_name=${JSON.stringify(state.mf?.short_name)} icons=${JSON.stringify((state.mf?.icons || []).map((i) => i.src))}${state.mfError ? ` (errors: ${state.mfError})` : ""}`,
	);
	console.log(`顶栏 img: ${state.imgSrc}（加载成功=${state.imgOk}）`);
	console.log(`标签页图标记录 ${state.iconLog.length} 条：`);
	for (const [t, sig] of state.iconLog)
		console.log(`   +${String(t).padStart(5)}ms  ${sig}`);

	const firstHref = state.iconLog.length
		? JSON.parse(state.iconLog[0][1])[0]?.href
		: undefined;
	// 站长那张最早什么时候出现在标签页上（用来判断是早跑脚本贴的、还是 React 挂载后才贴的）
	const firstCustomAt = state.iconLog.find(([, sig]) =>
		JSON.parse(sig).some((l) => l.href === expectIcon),
	)?.[0];
	const tabIcon = state.iconLinks[0];

	console.log("—— 站名 ——");
	check(
		"标签页标题 = 站名",
		state.title === SITE_NAME,
		`末值=${JSON.stringify(state.title)}`,
	);
	check(
		"iOS 主屏名 = 站名",
		state.metaTitle === SITE_NAME,
		`实际=${JSON.stringify(state.metaTitle)}`,
	);
	check(
		"PWA 清单 name = 站名",
		state.mf?.name === SITE_NAME,
		`实际=${JSON.stringify(state.mf?.name)}`,
	);
	check(
		"PWA 清单 short_name = 站名",
		state.mf?.short_name === SITE_NAME,
		`实际=${JSON.stringify(state.mf?.short_name)}`,
	);

	console.log("—— 站点图标 ——");
	check(
		"顶栏 img 用的是应显示的那张",
		state.imgSrc === expectIcon,
		`实际=${state.imgSrc}（期望 ${expectIcon}）`,
	);
	check("顶栏那张真的加载出来了", state.imgOk === true);
	check(
		"标签页图标 = 应显示的那张",
		tabIcon?.href === expectIcon,
		`实际=${tabIcon?.href}`,
	);
	check(
		"标签页图标只留一张 link",
		state.iconLinks.length === 1,
		`实际 ${state.iconLinks.length} 张`,
	);
	check(
		"标签页图标的 type 没被谎报",
		mimeOk(tabIcon?.href, tabIcon?.type),
		`href=${tabIcon?.href} type=${JSON.stringify(tabIcon?.type)}`,
	);
	check(
		"iOS 主屏图标跟着设置走",
		state.appleIcon === expectIcon,
		`实际=${state.appleIcon}`,
	);
	check(
		"清单里的 icons 跟着设置走",
		(state.mf?.icons || []).some((i) => String(i.src).includes(expectIcon)),
		`icons=${JSON.stringify((state.mf?.icons || []).map((i) => i.src))}`,
	);

	console.log("—— 别给访客添乱 ——");
	check(
		"浏览器解析到的 PWA 清单没有报错（blob 清单里的相对地址会被判无效）",
		!state.mfError,
		state.mfError || "无",
	);
	if (name.startsWith("③")) {
		// ③ 测的就是「站长那张取不到、退回自带图」这条路：自带图本来就得下一次
		warn(
			`这一场景自带图必然要下（退回它）：/favicon.svg 下载 ${state.netHits(FALLBACK)} 次`,
		);
	} else {
		check(
			"主题自带那张 /favicon.svg 没被网络下载",
			state.netHits(FALLBACK) === 0,
			`下载 ${state.netHits(FALLBACK)} 次`,
		);
	}
	check(
		"主题自带那张 android-chrome-192x192.png 没被网络下载",
		state.netHits("android-chrome") === 0,
		`下载 ${state.netHits("android-chrome")} 次`,
	);
	if (seeded) {
		// 判据落在机制上、不比毫秒：站长那张是在 React 接手之前就被贴上的吗？
		check(
			"返访：站长那张是早跑脚本贴的（React 接手前就已在标签页上）",
			firstCustomAt !== undefined &&
				state.ownedAt > 0 &&
				firstCustomAt < state.ownedAt,
			`贴上 ${firstCustomAt}ms vs React 接手 ${state.ownedAt}ms`,
		);
		// 这一条是时序决定的（页头 <img> 与标签页谁先发请求谁说了算，Chrome 不一定合并），
		// 所以只作信息：真正的风险是「并发把页头那张拉挂」，由上面「顶栏那张真的加载出来了」兜住。
		warn(
			`返访时站长那张下载 ${state.netHits(LOGO)} 次（理想 1 次：第二条应当是缓存命中）`,
		);
	} else {
		warn(
			`冷启动允许两条：站长那张下载 ${state.netHits(expectIcon)} 次（顶栏 <img> 与标签页各一条，相差几毫秒；` +
				`返访时第二个会命中缓存，见场景 ②），标签页图标第一条记录=${JSON.stringify(firstHref)}`,
		);
	}
	return state;
}

// ① 冷启动：全新 profile，localStorage 里什么都没有
const cold = await scenario("① 冷启动（没有缓存）", {
	seeded: false,
	expectIcon: LOGO,
});
check(
	"冷启动后把成功那张记进了缓存（下次加载不用等接口）",
	cold.cache === LOGO,
	`cache=${JSON.stringify(cold.cache)}`,
);

// ② 返访：把上次成功那张先塞进 localStorage
await js(`localStorage.setItem('nezha:site_icon', ${JSON.stringify(LOGO)})`);
await scenario("② 返访（有缓存）", { seeded: true, expectIcon: LOGO });

// ③ 站长设的图标取不到：应当退回主题自带那张，而且不许把坏地址记进缓存
themeConfig = { customLogo: BROKEN };
await js(`localStorage.removeItem('nezha:site_icon')`);
const broken = await scenario("③ 图标取不到（404）", {
	seeded: false,
	expectIcon: FALLBACK,
});
check(
	"取不到的地址没有被记进缓存",
	broken.cache !== BROKEN,
	`cache=${JSON.stringify(broken.cache)}`,
);

writeFileSync(
	process.env.SITE_IDENTITY_OUT ||
		`${process.env.TEMP || "."}/site-identity.json`,
	`${JSON.stringify({ cold, broken }, null, 1)}\n`,
);
console.log(`\n${pass} PASS / ${fail} FAIL`);
chrome?.kill();
server.close();
process.exit(fail ? 1 : 0);
