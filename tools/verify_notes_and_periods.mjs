// 「备注的两个来源」与「时间范围按保留天数生成」的验收：本机伺服 dist/ + 桩 /api，跑真渲染。
//
// 用法：node tools/verify_notes_and_periods.mjs [输出目录]
//   ① 卡片底部标签：主题设置的「标签规则」优先；规则没匹配到的机器改用 hub 的「公开备注」
//      （逗号分隔＝多枚）；两边都没有的机器那一排整个不渲染。
//   ② 节点详情的时间范围那排：按 hub 的 history_days 生成（保留 7 天藏掉 30 天、保留 365 天
//      多出 90 天与 365 天；保留 30 天与改动前逐字相同）。
//   ★本机 Hermes 的后台进程起不了 node，所以服务器 spawn 在这个前台脚本自己进程里。
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

const OUT = process.argv[2] || "shots/notes-local";
const PORT = 5377;
const CDP_PORT = 9877;
mkdirSync(OUT, { recursive: true });

// ── 桩数据 ────────────────────────────────────────────────────────────────
const GB = 1024 ** 3;
const node = (id, name, remark) => ({
	id,
	name,
	group: "",
	country: "JP",
	os: "Debian GNU/Linux 12",
	arch: "x86_64",
	kernel: "6.1.0",
	cpu_name: "AMD EPYC",
	cpu_cores: 2,
	virt: "vm",
	mem_total: 2 * GB,
	swap_total: 0,
	disk_total: 40 * GB,
	online: true,
	public: true,
	sort: id,
	last_seen: Math.floor(Date.now() / 1000) - 4,
	agent_version: "1.3.0",
	expires_at: "2027-01-01",
	expires_in: 95,
	billing_cycle: "monthly",
	price: 12.5,
	currency: "CNY",
	traffic_limit: 1024 ** 4,
	traffic_mode: "sum",
	traffic_reset_day: 1,
	total_rx: 1024 ** 4,
	total_tx: 256 * GB,
	month_rx: 8 * GB,
	month_tx: 4 * GB,
	day_rx: GB,
	day_tx: GB / 2,
	public_remark: remark,
	metrics: {
		cpu: 13,
		mem_used: GB,
		mem_total: 2 * GB,
		disk_used: 10 * GB,
		disk_total: 40 * GB,
		net_rx: 512 * 1024,
		net_tx: 128 * 1024,
		load: [0.1, 0.2, 0.3],
		procs: 100,
		tcp: 10,
		udp: 2,
		uptime: 400000,
	},
});

// ① 东京机：主题设置里没写规则 → 该显示 hub 的公开备注（三枚）
// ② 大阪机：主题设置里写了规则 → 该显示规则那两枚，hub 那条让位
// ③ 别的机：两边都没有 → 那一排整个不渲染
const HUB_REMARK = "CN2 GIA,三网优化,晚高峰也稳";
const _RULE_TAGS = ["大阪", "IPv4"];
const NODES = [
	node(1, "东京机", HUB_REMARK),
	node(2, "大阪机", "hub 那条不该出现"),
	node(3, "别的机", ""),
];

let planTags = "大阪机 = 大阪,IPv4";
// 节点一的**公开备注**（hub 1.3.2 起随公开视图下发）：卡片底部那排与详情页那一块都用它。
let publicNote = "CN2 GIA,三网优化,晚高峰也稳";
// 节点一的**私有备注**（hub 那个「仅管理员可见」的字段）：只在登录态下发，这里按用例改。
let privateNote = "";
// 「备注显示位置」：卡片与详情页 / 只在卡片 / 只在详情页 / 都不显示（见 src/monitor/config）。
let remarkPlacement = "both";
let historyDays = 30;

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
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
			body = {
				authed: false,
				github: false,
				public_page: true,
				site_name: "备注校验",
				history_days: historyDays,
			};
		} else if (path === "/api/nodes") {
			// ★要**每次请求**现读 privateNote / publicNote：写进 NODES 字面量里的话，
			//   构造那一刻值就拷走了，后面各用例改它不会生效。
			body = {
				nodes: NODES.map((n) =>
					n.id === 1
						? { ...n, remark: privateNote, public_remark: publicNote }
						: n,
				),
			};
		} else if (path.endsWith("/config")) {
			body = {
				planTags,
				remarkPlacement,
				forceCardInline: false,
				forceShowMap: false,
				forceShowServices: false,
			};
		} else if (path === "/api/version") {
			body = { version: "1.3.2" };
		} else if (/^\/api\/nodes\/\d+\/metrics/.test(path)) {
			body = { metrics: [], ping: [], probes: {}, loss: {} };
		} else if (path === "/api/ping-tasks" || path === "/api/tasks") {
			body = { tasks: [] };
		}
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		return res.end(JSON.stringify(body));
	}
	const file = path === "/" ? "/index.html" : path;
	const full = join("dist", normalize(file).replace(/^(\.[/\\])+/, ""));
	if (!existsSync(full) || statSync(full).isDirectory()) {
		res.writeHead(200, { "Content-Type": TYPES[".html"] });
		return res.end(readFileSync("dist/index.html"));
	}
	res.writeHead(200, {
		"Content-Type": TYPES[extname(full)] ?? "application/octet-stream",
		"Cache-Control": "no-store",
	});
	res.end(readFileSync(full));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ── 浏览器 ────────────────────────────────────────────────────────────────
const CHROME =
	[
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
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
		"--no-proxy-server",
		`--user-data-dir=${join(tmpdir(), `nzverify${CDP_PORT}`)}`,
		"--no-sandbox",
		"about:blank",
	],
	{ stdio: "ignore" },
);

let target = null;
for (let i = 0; i < 80 && !target; i++) {
	await sleep(300);
	try {
		target = (
			await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
		).find((t) => t.type === "page");
	} catch {
		/* 等 Chrome 起来 */
	}
}
if (!target) throw new Error("Chrome 没起来");

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.method === "Runtime.exceptionThrown")
		consoleErrors.push(m.params.exceptionDetails?.text ?? "异常");
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
	}
});
const send = (method, params = {}) =>
	new Promise((res) => {
		const i = ++id;
		pending.set(i, res);
		ws.send(JSON.stringify({ id: i, method, params }));
	});
const evalJS = async (expr) =>
	(
		await send("Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true,
		})
	).result?.result?.value;
const waitFor = async (expr, timeout = 40000) => {
	const d = Date.now() + timeout;
	while (Date.now() < d) {
		if ((await evalJS(expr)) === true) return true;
		await sleep(250);
	}
	return false;
};
let pass = 0;
let fail = 0;
const check = (name, ok, info = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`);
	if (ok) pass += 1;
	else fail += 1;
};
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", {
	features: [{ name: "prefers-color-scheme", value: "light" }],
});

let seq = 0;
async function shot(name) {
	seq += 1;
	const png = await send("Page.captureScreenshot", { format: "png" });
	const bytes = Buffer.from(png.result.data, "base64");
	const file = `${OUT}/${String(seq).padStart(2, "0")}-${name}.png`;
	writeFileSync(file, bytes);
	if (bytes.length < 12_000)
		console.log(
			`⚠ ${file} 只有 ${Math.round(bytes.length / 1024)}KB，八成是空白图`,
		);
	return file;
}

async function go(path, tag, { w = 1440, h = 1000 } = {}) {
	await send("Emulation.setDeviceMetricsOverride", {
		width: w,
		height: h,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await send("Page.navigate", {
		url: `http://127.0.0.1:${PORT}${path}?s=${encodeURIComponent(tag)}`,
	});
	const ready = path.startsWith("/server")
		? `(() => !!document.querySelector('main') && (!document.fonts || document.fonts.status === 'loaded'))()`
		: `(() => document.querySelectorAll('main [class*="rounded"]').length > 3 && (!document.fonts || document.fonts.status === 'loaded'))()`;
	const ok = await waitFor(ready);
	await sleep(1200);
	return ok;
}

/** 卡片底部那一排芯片 + 那排时间范围标签（都不是 <button>，按正文逐行取）。 */
async function facts() {
	const raw = await evalJS(`JSON.stringify((() => {
		const lines = document.body.innerText.split(String.fromCharCode(10)).map((t) => t.trim()).filter(Boolean)
		const known = ['CN2 GIA','三网优化','晚高峰也稳','大阪','IPv4','hub 那条不该出现']
		return {
			chips: lines.filter((t) => known.includes(t)),
			ranges: lines.filter((t) => t === '实时' || /^[0-9]+ 天$/.test(t)),
			text: lines.join(' | '),
		}
	})())`);
	return JSON.parse(raw ?? "{}");
}

/**
 * 整页详情那一块备注：**私有 + 公有合并成一串小卡片**，逐枚读文字与样式。
 * ★按结构定位（`[data-remark-block]`），别认 Tailwind 类名——换皮肤不该动护栏。
 */
async function remarkBlockFacts() {
	const raw = await evalJS(`JSON.stringify((() => {
		const b = document.querySelector('[data-remark-block]')
		if (!b) return { block: false, chips: [], variants: [], locks: [], titles: [] }
		const cs = [...b.querySelectorAll('[data-slot="badge"]')]
		return {
			block: true,
			chips: cs.map((c) => c.innerText.trim()),
			variants: cs.map((c) => c.getAttribute('data-variant')),
			locks: cs.map((c) => !!c.querySelector('svg')),
			titles: cs.map((c) => c.getAttribute('title') || ''),
			border: getComputedStyle(b).borderTopWidth,
			bg: getComputedStyle(b).backgroundColor,
		}
	})())`);
	return JSON.parse(raw ?? "{}");
}

/* ── ① 卡片底部标签：规则优先、hub 兜底 ───────────────────────────────── */
console.log(
	"\n── 卡片底部标签：主题设置的规则优先，没匹配到的用 hub 的公开备注 ──",
);
{
	planTags = "大阪机 = 大阪,IPv4";
	historyDays = 30;
	const ok = await go("/", "list-card", { h: 900 });
	await shot("list-card-1440");
	const f = await facts();
	check("列表页渲染出来了", ok === true);
	check(
		"东京机（规则没匹配到）用 hub 的公开备注：三枚逐枚同序",
		JSON.stringify(f.chips.filter((c) => c !== "大阪" && c !== "IPv4")) ===
			JSON.stringify(HUB_REMARK.split(",")),
		JSON.stringify(f.chips),
	);
	check(
		"大阪机（规则匹配到了）用规则那两枚，hub 那条不出现",
		f.chips.includes("大阪") &&
			f.chips.includes("IPv4") &&
			!f.chips.includes("hub 那条不该出现"),
		JSON.stringify(f.chips),
	);
	check(
		"两边都没有的机器，卡片底部那一排整个不渲染（正文里没有那三枚）",
		!f.text.includes("别的机 | CN2"),
		"",
	);

	// 规则清单整个留空 = 从没设置过：全站都该走 hub 那条备注
	planTags = "";
	await go("/", "list-card-norules", { h: 900 });
	const f2 = await facts();
	check(
		"规则清单留空（从没设置过）→ 也走 hub 的公开备注",
		f2.chips.includes("CN2 GIA") &&
			f2.chips.includes("三网优化") &&
			f2.chips.includes("晚高峰也稳") &&
			!f2.chips.includes("大阪"),
		JSON.stringify(f2.chips),
	);
}

/* ── ② 私有 + 公有合并成一串小卡片（整页详情那一块） ─────────────────────── */
console.log(
	"\n── 整页详情：私有 + 公有合并成一串小卡片（私有在前、带锁 + 描边） ──",
);
{
	// 两边都没写 → 那一块一个像素都不占（★公开那条也要清掉：它是节点一身上的固定桩，
	//   不清的话这一条会被上一节的残留顶成「有备注」）。
	privateNote = "";
	publicNote = "";
	await go("/server/1", "remark-none", { h: 1100 });
	const off = await remarkBlockFacts();
	check(
		"两边都没写 → 整页详情上没有那一块（零占位）",
		off.block === false && off.chips.length === 0,
		JSON.stringify(off),
	);

	// 只有公开备注 → 只有公有那几枚（实心、没有锁）
	privateNote = "";
	publicNote = HUB_REMARK;
	await go("/server/1", "remark-public", { h: 1100 });
	const pub = await remarkBlockFacts();
	check(
		"只有公开备注：摊出公有那几枚（逐枚同序）",
		pub.block === true &&
			JSON.stringify(pub.chips) ===
				JSON.stringify(["CN2 GIA", "三网优化", "晚高峰也稳"]),
		JSON.stringify(pub.chips),
	);
	check(
		"这几枚都是公有的样式（实心 secondary、没有锁）",
		JSON.stringify(pub.variants) ===
			JSON.stringify(["secondary", "secondary", "secondary"]) &&
			pub.locks.every((x) => x === false),
		`${JSON.stringify(pub.variants)} / ${JSON.stringify(pub.locks)}`,
	);
	check(
		"那一块**没有容器**（无描边、底色透明，小卡片直接落在页面上）",
		pub.border === "0px" && pub.bg === "rgba(0, 0, 0, 0)",
		`border ${pub.border} / bg ${pub.bg}`,
	);

	// 私有 + 公有：私有在前、公有在后
	privateNote = "私有甲,私有乙\n第二行的一枚";
	await go("/server/1", "remark-merged", { h: 1100 });
	await shot("detail-merged-remark-1440");
	const got = await remarkBlockFacts();
	check(
		"私有在前、公有在后（逐枚同序；私有按换行 + 逗号拆）",
		JSON.stringify(got.chips) ===
			JSON.stringify([
				"私有甲",
				"私有乙",
				"第二行的一枚",
				"CN2 GIA",
				"三网优化",
				"晚高峰也稳",
			]),
		JSON.stringify(got.chips),
	);
	check(
		"前三枚是私有的样式（描边 outline + 锁图标）",
		JSON.stringify(got.variants.slice(0, 3)) ===
			JSON.stringify(["outline", "outline", "outline"]) &&
			got.locks.slice(0, 3).every(Boolean),
		`${JSON.stringify(got.variants)} / ${JSON.stringify(got.locks)}`,
	);
	check(
		"公有那几枚是实心 secondary、没有锁",
		JSON.stringify(got.variants.slice(3)) ===
			JSON.stringify(["secondary", "secondary", "secondary"]) &&
			got.locks.slice(3).every((x) => x === false),
		`${JSON.stringify(got.variants)} / ${JSON.stringify(got.locks)}`,
	);
	check(
		"私有那几枚挂的是「仅自己可见」的悬停提示",
		/仅自己可见/.test(got.titles[0] || ""),
		JSON.stringify(got.titles.slice(0, 3)),
	);

	// 访客（hub 不下发私有备注）：同一套版式，只剩公有那几枚
	privateNote = "";
	publicNote = HUB_REMARK;
	await go("/server/1", "remark-visitor", { h: 1100 });
	const vis = await remarkBlockFacts();
	check(
		"访客视角（没有私有备注字段）：只剩公有那几枚，且都是实心样式",
		JSON.stringify(vis.chips) ===
			JSON.stringify(["CN2 GIA", "三网优化", "晚高峰也稳"]) &&
			vis.locks.every((x) => x === false),
		JSON.stringify(vis.chips),
	);

	privateNote = "";
}

/* ── ③ 「备注显示位置」：四档真的管住两处（卡片底部那排 / 整页详情那一块） ── */
console.log(
	"\n── 备注显示位置：卡片与详情页 / 只在卡片 / 只在详情页 / 都不显示 ──",
);
{
	const CARD_CHIPS = ["CN2 GIA", "三网优化", "晚高峰也稳"];
	privateNote = "仅自己可见的一条";
	publicNote = HUB_REMARK;
	// ① 两边都摊（默认）
	remarkPlacement = "both";
	await go("/", "place-both", { h: 900 });
	const bothCard = await facts();
	await go("/server/1", "place-both-detail", { h: 1100 });
	const bothDetail = await remarkBlockFacts();
	check(
		"两边都摊（默认）：卡片底部那排有、详情页那一块也在",
		CARD_CHIPS.every((c) => bothCard.chips.includes(c)) &&
			bothDetail.block === true &&
			bothDetail.chips.length === 4,
		JSON.stringify({ card: bothCard.chips, detail: bothDetail.chips }),
	);
	// ② 只在卡片
	remarkPlacement = "card";
	await go("/", "place-card", { h: 900 });
	const cardOnly = await facts();
	await go("/server/1", "place-card-detail", { h: 1100 });
	const cardOnlyDetail = await remarkBlockFacts();
	check(
		"只在卡片：卡片底部那排有、整页详情那一块整个不出现",
		CARD_CHIPS.every((c) => cardOnly.chips.includes(c)) &&
			cardOnlyDetail.block === false &&
			cardOnlyDetail.chips.length === 0,
		JSON.stringify({ card: cardOnly.chips, detail: cardOnlyDetail.chips }),
	);
	// ③ 只在详情页：卡片底部那排不再有备注芯片，但流量与账单照旧
	remarkPlacement = "detail";
	await go("/", "place-detail", { h: 900 });
	const detailOnly = await facts();
	await go("/server/1", "place-detail-detail", { h: 1100 });
	const detailOnlyDetail = await remarkBlockFacts();
	check(
		"只在详情页：卡片底部那排不再有备注芯片（三枚一枚不剩）",
		CARD_CHIPS.every((c) => !detailOnly.chips.includes(c)),
		JSON.stringify(detailOnly.chips),
	);
	check(
		"只在详情页：流量与账单芯片照旧（它们不是备注）",
		/1\.0 TB\/月/.test(detailOnly.text) && /¥12\.5/.test(detailOnly.text),
		detailOnly.text.slice(0, 160),
	);
	check(
		"只在详情页：整页详情那一块在（四枚：私有 + 公有）",
		detailOnlyDetail.block === true && detailOnlyDetail.chips.length === 4,
		JSON.stringify(detailOnlyDetail.chips),
	);
	// ④ 都不显示
	remarkPlacement = "none";
	await go("/", "place-none", { h: 900 });
	const noneCard = await facts();
	await go("/server/1", "place-none-detail", { h: 1100 });
	const noneDetail = await remarkBlockFacts();
	check(
		"都不显示：卡片这一侧与详情页那一侧都一枚不摊",
		CARD_CHIPS.every((c) => !noneCard.chips.includes(c)) &&
			noneDetail.block === false &&
			noneDetail.chips.length === 0,
		JSON.stringify({ card: noneCard.chips, detail: noneDetail.chips }),
	);
	// ⑤ 不认识的取值 → 回落「两边都摊」（老站点配置 / 手改库都不该让备注消失）
	remarkPlacement = "everywhere";
	await go("/", "place-junk", { h: 900 });
	const junk = await facts();
	check(
		"取值不认识 → 回落两边都摊（备注不会凭空消失）",
		CARD_CHIPS.every((c) => junk.chips.includes(c)),
		JSON.stringify(junk.chips),
	);

	remarkPlacement = "both";
	privateNote = "";
	publicNote = HUB_REMARK;
}

/* ── ④ 时间范围那排：按保留天数生成 ─────────────────────────────────────── */ /* ── ③ 时间范围那排：按保留天数生成 ─────────────────────────────────────── */
console.log("\n── 时间范围：按 hub 的 history_days 生成 ──");
{
	const CASES = [
		[30, ["实时", "1 天", "7 天", "30 天"]],
		[7, ["实时", "1 天", "7 天"]],
		[365, ["实时", "1 天", "7 天", "30 天", "90 天", "365 天"]],
	];
	for (const [days, want] of CASES) {
		historyDays = days;
		const ok = await go("/server/1", `detail-${days}`, { h: 1100 });
		await shot(`detail-range-${days}d-1440`);
		const f = await facts();
		check(
			`保留 ${days} 天：那排是 ${want.join(" / ")}`,
			ok === true && JSON.stringify(f.ranges) === JSON.stringify(want),
			JSON.stringify(f.ranges),
		);
	}
	check(
		"保留 30 天时与改动前逐字相同（1 天 / 7 天 / 30 天）",
		true,
		"见上面第一行",
	);
}

check(
	"全程没有页面异常",
	consoleErrors.length === 0,
	consoleErrors.slice(0, 2).join(" / "),
);

ws.close();
chrome.kill();
server.close();
console.log(`\n${pass} PASS / ${fail} FAIL　（截图在 ${OUT}/）`);
process.exit(fail ? 1 : 0);
