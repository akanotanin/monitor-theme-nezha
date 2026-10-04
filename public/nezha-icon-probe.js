// 站点图标/站名的头一步：在入口包之前就把站长那张图标贴上去。
//
// 为什么必须是入口包之外的独立文件：浏览器是在**解析 HTML 的时候**去取 favicon 的，
// 等 React 挂载（几百 KB 之后）再改，标签页上已经闪了一下主题自带那张，而且
// /favicon.svg 那次请求也白发了。
//
// 两步，与 public/nezha-title-probe.js 同一套路：
//   1) 贴缓存 —— 上次「真的加载成功」的地址（键与 src/monitor/site-identity.ts 一致）；
//   2) 没有缓存（首次访问）或站长刚换过图标时，早问一次主题设置。这条请求会交给
//      入口包复用（window.__nezhaThemeConfigPromise，见 src/monitor/config.ts），
//      所以「主题设置」每次加载仍然只发一条。
// 缓存只在顶栏那张图真的加载成功后才写（由 Header 负责），取不到的地址不会被记下来。
//
// 做成独立文件而不是内联脚本：站点前面若有 CSP，内联脚本会被挡掉。
(() => {
	var KEY = "nezha:site_icon";
	var SHORT = "nezha";
	var MIME = {
		svg: "image/svg+xml",
		png: "image/png",
		ico: "image/x-icon",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		webp: "image/webp",
		gif: "image/gif",
	};

	function iconMime(href) {
		var clean = String(href).split(/[?#]/)[0];
		var dot = clean.lastIndexOf(".");
		if (dot < 0) return null;
		return MIME[clean.slice(dot + 1).toLowerCase()] || null;
	}

	// rel 里要有 icon 这个词才算标签页图标（apple-touch-icon 是一个词，不算）
	function isTabIcon(rel) {
		return rel.split(/\s+/).indexOf("icon") >= 0;
	}

	function applyIcon(href) {
		var head = document.head;
		var links = Array.prototype.slice
			.call(head.querySelectorAll("link[rel]"))
			.filter((node) => isTabIcon(node.getAttribute("rel") || ""));
		var link = links[0] || document.createElement("link");
		if (!link.parentNode) head.appendChild(link);
		link.rel = "icon";
		var mime = iconMime(href);
		if (mime) link.setAttribute("type", mime);
		else link.removeAttribute("type");
		link.setAttribute("href", href);
		links.slice(1).forEach((extra) => {
			extra.remove();
		});

		var apple = head.querySelector('link[rel="apple-touch-icon"]');
		if (!apple) {
			apple = document.createElement("link");
			apple.rel = "apple-touch-icon";
			head.appendChild(apple);
		}
		apple.removeAttribute("type");
		apple.setAttribute("href", href);
	}

	var cached = null;
	try {
		cached = localStorage.getItem(KEY);
	} catch {
		// 隐私模式 / 存储被禁用：跳过缓存这一步，下面照常早问一次
	}
	if (cached) applyIcon(cached);

	if (!window.fetch) return;
	var pending = fetch(`/api/themes/${SHORT}/config`, {
		credentials: "same-origin",
	})
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null);
	// 交给入口包复用，别让同一条接口发两次
	window.__nezhaThemeConfigPromise = pending;
	pending.then((cfg) => {
		// React 已经按「真的加载成功的那张」定下来了：那条迟到的设置响应不许再改图标
		// （实测过：站长那张图挂掉、页面已经退回自带图之后，它会把坏地址又改回来，
		//  还会把坏地址写进缓存）
		if (window.__siteIconOwned) return;
		var icon = cfg && typeof cfg.customLogo === "string" ? cfg.customLogo : "";
		if (!icon || icon === cached) return;
		applyIcon(icon);
	});
})();
