/**
 * 极简探针（Monitor）侧的数据结构。
 *
 * 这些类型只出现在 src/monitor/ 里：上游组件读的仍然是 nezha-api 的视图模型，
 * 由 mapping.ts 在这里翻译过去，因此组件、store、样式一行都不用改。
 */

/** 节点实时指标（`/api/nodes` 与 `/api/ws` 帧里的 metrics）。 */
export interface MonitorMetrics {
	cpu?: number;
	mem_used?: number;
	mem_total?: number;
	swap_used?: number;
	swap_total?: number;
	disk_used?: number;
	disk_total?: number;
	/** 瞬时速率，字节/秒。 */
	net_rx?: number;
	net_tx?: number;
	/** 1 / 5 / 15 分钟负载。 */
	load?: number[];
	procs?: number;
	tcp?: number;
	udp?: number;
	uptime?: number;
	total_rx?: number;
	total_tx?: number;
	month_rx?: number;
	month_tx?: number;
}

export interface MonitorNode {
	id: number;
	name: string;
	group?: string | null;
	country?: string | null;
	os?: string | null;
	arch?: string | null;
	kernel?: string | null;
	cpu_name?: string | null;
	cpu_cores?: number | null;
	virt?: string | null;
	mem_total?: number | null;
	swap_total?: number | null;
	disk_total?: number | null;
	online?: boolean;
	public?: boolean;
	sort?: number;
	last_seen?: number;
	/**
	 * 站长在后台写给访客的一行说明（单行、≤100 字，留空是空串）。hub 1.3.2 起随**公开视图**
	 * 一起下发，所以匿名也拿得到——与节点上那个私有的 `remark` 不是一回事。老 hub 没有这个 key。
	 * 它是卡片底部标签的**兜底来源**：主题设置里的「标签规则」没匹配到这台时才用它（见 config.ts）。
	 */
	public_remark?: string | null;
	/**
	 * 站长在后台写给**自己**看的备注（可以多行、可以很长）。hub 只把它下发给登录的管理员，
	 * 匿名视图里这个 key 根本不存在——所以整页详情那一块只有站长自己看得到。
	 * 与上面的 `public_remark` 不是一回事：那个给访客、单行、≤100 字。
	 */
	remark?: string | null;
	agent_version?: string | null;
	expires_at?: string | null;
	expires_in?: number | null;
	billing_cycle?: string | null;
	price?: number | null;
	currency?: string | null;
	traffic_limit?: number | null;
	traffic_mode?: string | null;
	traffic_reset_day?: number | null;
	total_rx?: number;
	total_tx?: number;
	day_rx?: number;
	day_tx?: number;
	month_rx?: number;
	month_tx?: number;
	month_used?: number;
	month_start?: string | null;
	metrics?: MonitorMetrics;
}

/** `/api/nodes` 与 `/api/ws` 是同一个帧。 */
export interface MonitorSnapshot {
	admin?: boolean;
	nodes?: MonitorNode[];
}

export interface MonitorMe {
	authed?: boolean;
	github?: string | null;
	public_page?: boolean;
	site?: string;
	site_name?: string;
	/**
	 * hub 的历史保留天数（1~365，1.3.2 起默认 30）。时间范围那排按钮按它生成（见 periods.ts）；
	 * 老 hub 不给这个字段，按 7 天算——正好是 1.15.x 时代那排。
	 */
	history_days?: number;
}

/** 一条 Ping 采样：latency 为 -1 表示这次探测失败（丢包）。 */
export interface MonitorPingRow {
	latency: number;
	task_id: number;
	ts: number;
}

/** 历史采样只有这几列，`ts` 是秒。 */
export interface MonitorHistorySample {
	ts: number;
	cpu?: number;
	mem_used?: number;
	disk_used?: number;
	net_rx?: number;
	net_tx?: number;
	loss?: number;
}

export interface MonitorHistory {
	metrics?: MonitorHistorySample[];
	ping?: MonitorPingRow[];
	/** task_id -> 线路名。 */
	probes?: Record<string, string>;
	/** task_id -> 整个窗口的丢包百分比。 */
	loss?: Record<string, number>;
}
