import type { ComponentType } from "react";

/**
 * 节点详情页那个异步 chunk（recharts + d3 + redux ≈ 450KB / 17 个文件）的加载时机。
 *
 * 上游在 App 挂载时就 `loadServerDetail()` —— 于是**每个首页访客**（哪怕从不点开任何节点）
 * 都要多下这一坨（实测 449.5KB，见 `tools/audit_home_requests.mjs`）。这里改成**按意图加载**：
 * 指针碰到卡片（鼠标悬停 / 手指按下）时才去拉。
 *
 * 直接开 `/server/:id`（外链、刷新、书签）不受影响：路由本身就是 `lazy()` 的，
 * 这一份只是「提前一步」，拉不到就先显示骨架（见 App.tsx 的 Suspense fallback）。
 */
type ServerDetailModule = { default: ComponentType };

let inflight: Promise<ServerDetailModule> | null = null;

/**
 * 拉详情页那个 chunk（同一份 chunk 只会拉一次；App.tsx 的 `lazy()` 也用这个函数）。
 * 失败了要把缓存清掉：拉失败不该变成「以后再也拉不动」。
 */
export function prefetchServerDetail(): Promise<ServerDetailModule> {
	inflight ??= import("@/pages/ServerDetail").catch((error: unknown) => {
		inflight = null;
		throw error;
	}) as Promise<ServerDetailModule>;
	return inflight;
}
