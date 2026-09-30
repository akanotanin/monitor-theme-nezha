// 标签页标题的头一步：站名是站长在后台改的，静态 HTML 不可能知道，所以这里
// 1) 先把上一次的站名（localStorage，本站自己的来源）贴上——刷新时标题立刻换成真站名，
//    要等的只是这个 1KB 文件（而不是那几百 KB 的入口包）；
// 2) 没有缓存（首次访问）时自己问一次 /api/me —— 它通常比入口包先回来，标题就能早点贴对，
//    而不是等入口包执行完才从那句兜底值跳过去。
//
// 一旦 React 接手（window.__titleOwned，见 src/components/Header.tsx），这里就再也不碰标题：
// 那条迟到的响应不许把 React 写好的标题改回去。
//
// 做成独立文件而不是内联脚本：站点前面若有 CSP，内联脚本会被挡掉；这里的地址也便于各站自己换。
// 缓存键必须与 src/components/Header.tsx 里的 TITLE_CACHE_KEY 一致。
(() => {
	var KEY = "nezha-dash:site_name";
	var cached = null;
	try {
		cached = localStorage.getItem(KEY);
	} catch {
		// 隐私模式 / 存储被禁用：跳过缓存这一步，下面照常早问一次。
	}
	if (cached) {
		document.title = cached;
		// 给验收/排查留个来源标记：这一版标题是「贴的缓存」还是「自己早问来的」。
		window.__titleProbeSource = "cache";
		return;
	}
	if (!window.fetch) return;
	// 带个只用于区分的查询参数：hub 不看查询串，这条请求只是好在日志与验收里
	// 与 React 那条 /api/me 分开（推迟其中一条，就能把「迟到的响应」这个竞态造出来）。
	fetch("/api/me?theme-title=1", { credentials: "same-origin" })
		.then((r) => r.json())
		.then((d) => {
			if (!d || !d.site_name || window.__titleOwned) return;
			window.__titleProbeSource = "fetch";
			document.title = d.site_name;
			try {
				localStorage.setItem(KEY, d.site_name);
			} catch {}
		})
		.catch(() => {});
})();
