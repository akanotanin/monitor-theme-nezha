import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 这一层现在只做转发：`src/lib/nezha-api.ts` 的每个函数都落到 `src/monitor/bridge.ts`，
 * 数据源从哪吒的 `/api/v1/*` 换成了极简探针的 `/api/*`。所以这里断言的是**新的接口契约** ——
 * 打哪些 URL、参数怎么拼、拿回来的形状对不对（上游那套 `/api/v1/*` 与 token 刷新已经不存在了）。
 */
const jsonResponse = (body: unknown, init?: ResponseInit) =>
	new Response(JSON.stringify(body), {
		status: init?.status ?? 200,
		statusText: init?.statusText,
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
	});

const ME = {
	authed: false,
	github: null,
	public_page: true,
	site: "",
	site_name: "探针站",
	history_days: 30,
};
const CONFIG = { language: "zh-CN", planTags: "" };

const monitorNode = (id: number, name: string, online = true) => ({
	id,
	name,
	group: "",
	country: "JP",
	os: "Debian GNU/Linux 12 (bookworm)",
	arch: "x86_64",
	virt: "vm",
	cpu_cores: 2,
	online,
	public: true,
	sort: id,
	last_seen: Math.floor(Date.now() / 1000),
	mem_total: 2 * 1024 ** 3,
	disk_total: 40 * 1024 ** 3,
	traffic_limit: 1024 ** 4,
	month_used: 1024 ** 3,
	month_start: "2026-10-01",
	metrics: {
		cpu: 12,
		mem_used: 1024 ** 3,
		mem_total: 2 * 1024 ** 3,
		disk_used: 10 * 1024 ** 3,
		disk_total: 40 * 1024 ** 3,
		net_rx: 512,
		net_tx: 128,
		uptime: 400000,
	},
});
const NODES = {
	admin: false,
	nodes: [
		monitorNode(1, "东京"),
		monitorNode(2, "大阪"),
		monitorNode(3, "下线机", false),
	],
};

/** 一条今天的 ping 采样（延迟监控按天聚合，落在今天这一格才进得了「今天」）。 */
const TODAY = Math.floor(Date.now() / 1000);
const PING = {
	ping: [{ task_id: 1, latency: 42, ts: TODAY }],
	probes: { 1: "北京电信" },
	loss: { 1: 0 },
};
const METRICS = {
	metrics: [
		{
			ts: 1_700_000_000,
			cpu: 12,
			mem_used: 1024,
			disk_used: 2048,
			net_rx: 8,
			net_tx: 4,
		},
	],
};

/** 桩 fetch：按 URL 分派成探针那几份回包，并记下每次请求的 URL。 */
function stubFetch() {
	const fn = vi.fn((input: unknown) => {
		const url = String(input);
		if (url === "/api/me") return Promise.resolve(jsonResponse(ME));
		if (url === "/api/nodes") return Promise.resolve(jsonResponse(NODES));
		if (url.endsWith("/config")) return Promise.resolve(jsonResponse(CONFIG));
		if (url.includes("series=ping")) return Promise.resolve(jsonResponse(PING));
		if (url.includes("series=metrics"))
			return Promise.resolve(jsonResponse(METRICS));
		return Promise.resolve(jsonResponse({}));
	});
	vi.stubGlobal("fetch", fn);
	return fn;
}

const urlsOf = (fn: ReturnType<typeof stubFetch>) =>
	fn.mock.calls.map((call) => String(call[0]));

/**
 * 桥接层带模块级缓存（快照 / 历史 / 配置），所以每个用例都重新加载一遍模块，
 * 免得上一个用例的缓存把这一个的断言变成「其实没发请求」。
 */
async function loadApi() {
	vi.resetModules();
	return await import("@/lib/nezha-api");
}

describe("nezha api fetchers（转发到探针的公开接口）", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("站点设置 = /api/me + 主题配置", async () => {
		const fetchMock = stubFetch();
		const lib = await loadApi();

		const setting = await lib.fetchSetting();

		expect(urlsOf(fetchMock).filter((url) => url === "/api/me")).toHaveLength(
			1,
		);
		expect(urlsOf(fetchMock)).toContain("/api/themes/nezha/config");
		expect(setting.success).toBe(true);
		expect(setting.data.config.site_name).toBe("探针站");
		expect(setting.data.config.language).toBe("zh-CN");
		// 探针存历史 → 详情页的历史曲线照常画（上游靠这个字段决定要不要显示）
		expect(setting.data.tsdb_enabled).toBe(true);
	});

	it("匿名访客的登录态来自 /api/me（id 0、没有用户名）", async () => {
		const fetchMock = stubFetch();
		const lib = await loadApi();

		const user = await lib.fetchLoginUser();

		expect(urlsOf(fetchMock)).toEqual(["/api/me"]);
		expect(user.success).toBe(true);
		expect(user.data.id).toBe(0);
		expect(user.data.username).toBe("");
	});

	it("延迟监控只给在线节点取 ping 序列，并按探测线路聚合成 services", async () => {
		const fetchMock = stubFetch();
		const lib = await loadApi();

		const service = await lib.fetchService(1);

		const urls = urlsOf(fetchMock);
		expect(urls.filter((url) => url.includes("/metrics")).sort()).toEqual([
			"/api/nodes/1/metrics?hours=1&series=ping",
			"/api/nodes/2/metrics?hours=1&series=ping",
		]);
		// 节点列表来自快照那条（分组名/节点名都要它）
		expect(urls).toContain("/api/nodes");
		const entry = service.data.services?.["1"];
		expect(entry?.service_name).toBe("北京电信（2 个节点）");
		// 工程 target 是 ES2020，没有 Array.prototype.at
		const last = (list: number[] = []) => list[list.length - 1];
		expect(last(entry?.delay)).toBe(42);
		// 同一条探测线路、两台机器各一条采样 → 今天这一格计 2 次探测
		expect(last(entry?.up)).toBe(2);
		expect(last(entry?.down)).toBe(0);
	});

	it("指标序列：hours 跟着窗口档位走，ts 由秒转毫秒", async () => {
		const fetchMock = stubFetch();
		const lib = await loadApi();

		const metrics = await lib.fetchServerMetrics(2, "cpu", "30d");

		expect(urlsOf(fetchMock).filter((url) => url.includes("/metrics"))).toEqual(
			["/api/nodes/2/metrics?hours=720&series=metrics"],
		);
		expect(metrics.data.data_points).toHaveLength(1);
		expect(metrics.data.data_points[0].ts).toBe(1_700_000_000 * 1000);
		expect(metrics.data.data_points[0].value).toBe(12);
	});

	it("单节点延迟监控：7 天 = 168 小时", async () => {
		const fetchMock = stubFetch();
		const lib = await loadApi();

		const monitor = await lib.fetchMonitor(1, "7d");

		expect(urlsOf(fetchMock).filter((url) => url.includes("/metrics"))).toEqual(
			["/api/nodes/1/metrics?hours=168&series=ping"],
		);
		expect(monitor.data?.[0]?.monitor_name).toBe("北京电信");
		expect(monitor.data?.[0]?.avg_delay?.[0]).toBe(42);
	});

	it("并发的「设置 + 登录态」只打一条 /api/me", async () => {
		const fetchMock = stubFetch();
		const lib = await loadApi();

		await Promise.all([lib.fetchSetting(), lib.fetchLoginUser()]);

		expect(urlsOf(fetchMock).filter((url) => url === "/api/me")).toHaveLength(
			1,
		);
	});
});
