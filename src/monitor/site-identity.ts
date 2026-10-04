/**
 * 站点身份：站名与「站点图标」落到浏览器外壳的那些地方。
 *
 * 上游只把 customLogo 用在顶栏那张 <img> 上，顺手在 Header 里把 link[rel=icon] 的
 * type 谎报成 image/x-icon；于是「站长设了图标」这件事只兑现了一半：
 *   - 标签页会先闪一下主题自带那张，还白下一次请求；
 *   - iOS「添加到主屏」的图标（apple-touch-icon）仍是主题自带的 android-chrome；
 *   - iOS 主屏名（apple-mobile-web-app-title）写死着主题名，PWA 清单名写死着上游名。
 * 这里做「一处设置、四处一致」：标签页图标、iOS 主屏图标、PWA 清单的名称与图标、
 * iOS 主屏名，全部由站名 + customLogo 驱动。
 *
 * 只在这个文件里碰 <head>，组件那边只管把值递进来。
 */

/** 上次「真的加载成功」的图标地址；public/nezha-icon-probe.js 读的是同一个键。 */
export const ICON_CACHE_KEY = "nezha:site_icon";

/** 主题自带那张：站长没设图标、或者设的地址取不到时退到它。 */
export const FALLBACK_ICON = "/favicon.svg";

/** 早跑脚本那条「早问一次设置」是异步的，可能晚于 React 加载成功才回来。 */
type IconOwnedWindow = { __siteIconOwned?: boolean };

const MIME: Record<string, string> = {
	svg: "image/svg+xml",
	png: "image/png",
	ico: "image/x-icon",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

/**
 * 按扩展名给 link 的 type。认不出来就返回 null（不写 type 让浏览器自己嗅探，
 * 比写错强 —— 上游那种「任何地址都写 image/x-icon」会让浏览器拿着错的类型提示去判断）。
 */
function iconMime(href: string): string | null {
	const clean = href.split(/[?#]/)[0];
	const dot = clean.lastIndexOf(".");
	if (dot < 0) return null;
	return MIME[clean.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * blob 清单没有 URL 基准，相对地址（`"start_url": "/"`、图标的 `/logo.png`）会被浏览器
 * 判成无效、整条丢掉 —— 实测 Page.getAppManifest 报「property 'start_url' ignored,
 * URL is invalid」。所以在写进 blob 之前一律解析成绝对地址。
 */
function absolutize(value: unknown): unknown {
	if (typeof value !== "string" || !value) return value;
	try {
		return new URL(value, document.baseURI).href;
	} catch {
		return value;
	}
}

/** 标签页图标链的判定：rel 里要有 icon 这个词（apple-touch-icon 是一个词，不算）。 */
const isTabIconLink = (rel: string) => rel.split(/\s+/).includes("icon");

function applyTabIcon(href: string) {
	const head = document.head;
	const links = [...head.querySelectorAll("link[rel]")].filter((node) =>
		isTabIconLink(node.getAttribute("rel") ?? ""),
	);
	const link = (links[0] ?? document.createElement("link")) as HTMLLinkElement;
	if (!link.parentNode) head.appendChild(link);
	link.rel = "icon";
	const mime = iconMime(href);
	if (mime) link.setAttribute("type", mime);
	else link.removeAttribute("type");
	link.setAttribute("href", href);
	// 历史上被拼出来的第二张（上游那段 effect 每换一次地址就 appendChild 一次）清掉
	for (const extra of links.slice(1)) extra.remove();
}

function applyAppleTouchIcon(href: string) {
	const head = document.head;
	let link = head.querySelector(
		'link[rel="apple-touch-icon"]',
	) as HTMLLinkElement | null;
	if (!link) {
		link = document.createElement("link");
		link.rel = "apple-touch-icon";
		head.appendChild(link);
	}
	// iOS 不认 type，写了只会误导；地址对就行
	link.removeAttribute("type");
	link.setAttribute("href", href);
}

function applyName(name: string) {
	const head = document.head;
	let meta = head.querySelector('meta[name="apple-mobile-web-app-title"]');
	if (!meta) {
		meta = document.createElement("meta");
		meta.setAttribute("name", "apple-mobile-web-app-title");
		head.appendChild(meta);
	}
	meta.setAttribute("content", name);
}

let baseManifest: Promise<Record<string, unknown> | null> | null = null;
let manifestObjectUrl: string | null = null;

/** 取静态清单当底稿（只取一次）；取不到就返回 null，这时宁可不动清单。 */
function loadBaseManifest() {
	if (!baseManifest) {
		baseManifest = fetch("/manifest.json", { credentials: "same-origin" })
			.then((res) => (res.ok ? res.json() : null))
			.catch(() => null)
			.then((json) =>
				json && typeof json === "object" && Object.keys(json).length > 0
					? (json as Record<string, unknown>)
					: null,
			);
	}
	return baseManifest;
}

/**
 * PWA 清单是静态文件，站名与图标却在后台里 —— 取回来改完，用 blob 地址挂回去。
 * 浏览器是按 `link[rel=manifest]` 现读的，换掉 href 后 Page.getAppManifest 读到的
 * 就是改过的那份（验收脚本断言的就是它）。
 *
 * ★ 静态清单里刻意不写 icons：浏览器在**解析 HTML 时**就把清单读走、并把它声明的图标
 * 取下来（实测 +43ms 读清单、+65ms 取那张 android-chrome），那会儿 JS 还没跑，
 * 于是每个访客都白下 4.8KB 主题自带图 —— 而这张图跟站长设的图标毫无关系。
 * 图标统一由这里写进运行时那份清单。
 */
async function applyManifest(name: string, icon: string) {
	const link = document.querySelector(
		'link[rel="manifest"]',
	) as HTMLLinkElement | null;
	if (!link) return;
	const base = await loadBaseManifest();
	if (!base) return;
	const next: Record<string, unknown> = {
		...base,
		name,
		short_name: name,
		// sizes 写 any：站长的图标多大、什么格式都不知道，写死 192x192 是假话
		icons: [
			{
				src: absolutize(icon),
				sizes: "any",
				type: iconMime(icon) ?? "image/png",
				purpose: "any maskable",
			},
		],
	};
	for (const key of ["start_url", "scope", "id"]) {
		if (key in next) next[key] = absolutize(next[key]);
	}
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(next)], { type: "application/manifest+json" }),
	);
	link.setAttribute("href", url);
	if (manifestObjectUrl) URL.revokeObjectURL(manifestObjectUrl);
	manifestObjectUrl = url;
}

let siteName = "";
let siteIcon = FALLBACK_ICON;
let applying = false;
// 重写清单期间又来了新值（站长那张图后加载成功、或站名后到）：标记一下，写完再补一次。
// 早先这里是个布尔开关「正在写就 return」，会把那次更新默默吞掉 —— 表现是
// 清单里的图标随机停在自带那张（谁先到谁说话）。
let reapply = false;

/** 把当前 name/icon 落到清单上；正在写就排队，写完用最新值再写一次。 */
function scheduleManifest() {
	if (applying) {
		reapply = true;
		return;
	}
	applying = true;
	void applyManifest(siteName, siteIcon).finally(() => {
		applying = false;
		if (reapply) {
			reapply = false;
			scheduleManifest();
		}
	});
}

/**
 * 把站名/图标落到浏览器外壳。两个值谁先到都行，站名没到手之前不碰清单。
 * `icon` 传空串表示退回主题自带那张。
 */
export function applySiteIdentity(
	patch: { name?: string | null; icon?: string | null } = {},
) {
	if (typeof patch.icon === "string") {
		siteIcon = patch.icon || FALLBACK_ICON;
		applyTabIcon(siteIcon);
		applyAppleTouchIcon(siteIcon);
		// React 认下来的这个地址从此说了算：早跑脚本那条迟到的响应得让路，
		// 否则「站长那张图挂了 → 已经退回自带图」之后，它会把坏地址又改回来。
		(window as unknown as IconOwnedWindow).__siteIconOwned = true;
	}
	if (typeof patch.name === "string" && patch.name) {
		siteName = patch.name;
		applyName(siteName);
	}
	// 清单每次都重挂：静态清单里刻意没有 icons（见 applyManifest），
	// 图标只能由这份运行时清单提供，站长没改过设置时也一样。
	if (!siteName) return;
	scheduleManifest();
}
