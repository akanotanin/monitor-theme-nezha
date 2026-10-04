import { describe, expect, it } from "vitest";

import {
	REMARK_PLACEMENTS,
	remarkChips,
	remarksOnCards,
	remarksOnDetail,
	resolvePlanTagsFor,
	tagsFromRemark,
} from "@/monitor/config";
import { buildPublicNote, toNezhaServer } from "@/monitor/mapping";
import {
	historyDays,
	periodHours,
	periodsFor,
	setHistoryDays,
} from "@/monitor/periods";

/**
 * 备注的两个来源（主题设置的「标签规则」优先、hub 的「公开备注」兜底）与
 * 时间范围按保留天数生成。两条线都是纯函数 + 一个小缓存，所以能脱开网络与 React 单测。
 */
const RULES = [
	"东京机 = CN2 GIA,三网优化",
	"IPv4 机 = IPv4,高防",
	"* = 兜底标签",
].join("\n");

describe("备注的两个来源", () => {
	it("主题设置的规则匹配到这台 → 用规则，hub 那条让位", () => {
		const tags = resolvePlanTagsFor(
			{ name: "东京机", public_remark: "hub备注A,hub备注B" },
			RULES,
		);
		expect(tags).toEqual({
			bandwidth: "CN2 GIA",
			ipv4: false,
			ipv6: false,
			extra: "三网优化",
		});
	});

	it("规则里没有这台（也没写 `*` 兜底）→ 用 hub 的公开备注", () => {
		const tags = resolvePlanTagsFor(
			{ name: "别的机器", public_remark: "备注1,备注测试2" },
			"东京机 = 三网优化",
		);
		expect(tags).toEqual({
			bandwidth: "备注1",
			ipv4: false,
			ipv6: false,
			extra: "备注测试2",
		});
	});

	it("规则清单整个留空（从没设置过）→ 也是用 hub 的公开备注", () => {
		const tags = resolvePlanTagsFor(
			{ name: "东京机", public_remark: "只此一枚" },
			"",
		);
		expect(tags).toEqual({
			bandwidth: "只此一枚",
			ipv4: false,
			ipv6: false,
			extra: "",
		});
	});

	it("两边都没有 → 全空（卡片底部那一排整个不渲染）", () => {
		const tags = resolvePlanTagsFor({ name: "东京机" }, "");
		expect(tags).toEqual({
			bandwidth: "",
			ipv4: false,
			ipv6: false,
			extra: "",
		});
	});

	it("`*` 兜底也算「规则匹配到了」，此时不该再去看 hub 那条", () => {
		const tags = resolvePlanTagsFor(
			{ name: "没写规则的机器", public_remark: "hub 那条" },
			RULES,
		);
		expect(tags).toEqual({
			bandwidth: "兜底标签",
			ipv4: false,
			ipv6: false,
			extra: "",
		});
	});

	it("hub 的公开备注按逗号切：第一枚进带宽格、其余进灰标签", () => {
		expect(tagsFromRemark("CN2 GIA,三网优化,晚高峰也稳")).toEqual({
			bandwidth: "CN2 GIA",
			ipv4: false,
			ipv6: false,
			extra: "三网优化,晚高峰也稳",
		});
	});

	it("全角逗号也认，两侧空白削掉、空片段丢掉", () => {
		expect(tagsFromRemark(" a ， , b ,")).toEqual({
			bandwidth: "a",
			ipv4: false,
			ipv6: false,
			extra: "b",
		});
	});

	it("认得出 IPv4 / IPv6（与规则同一套芯片）", () => {
		expect(tagsFromRemark("IPv4,IPv6,高防")).toEqual({
			bandwidth: "高防",
			ipv4: true,
			ipv6: true,
			extra: "",
		});
	});

	it("没有备注 / 只有空白 / null 都是「什么都没有」", () => {
		const empty = { bandwidth: "", ipv4: false, ipv6: false, extra: "" };
		expect(tagsFromRemark("")).toEqual(empty);
		expect(tagsFromRemark("   ")).toEqual(empty);
		expect(tagsFromRemark(null)).toEqual(empty);
		expect(tagsFromRemark(undefined)).toEqual(empty);
	});
});

describe("时间范围按保留天数生成", () => {
	it("保留 30 天 = 1 天 / 7 天 / 30 天（与改动前逐字相同）", () => {
		expect(periodsFor(30)).toEqual(["1d", "7d", "30d"]);
	});

	it("只留 7 天时藏掉 30 天", () => {
		expect(periodsFor(7)).toEqual(["1d", "7d"]);
	});

	it("留 90 天时到 90 天为止，留 365 天时多出 365 天", () => {
		expect(periodsFor(90)).toEqual(["1d", "7d", "30d", "90d"]);
		expect(periodsFor(365)).toEqual(["1d", "7d", "30d", "90d", "365d"]);
	});

	it("保留天数很短时至少留「1 天」，且任何一档都不超过保留天数", () => {
		expect(periodsFor(3)).toEqual(["1d"]);
		expect(periodsFor(1)).toEqual(["1d"]);
		for (const days of [1, 3, 7, 14, 30, 60, 90, 200, 365]) {
			const list = periodsFor(days);
			expect(list.length).toBeGreaterThan(0);
			for (const period of list) {
				expect(periodHours(period)).toBeLessThanOrEqual(days * 24);
			}
		}
	});

	it("每一档都有小时数（新档位也不例外）", () => {
		expect(periodHours("1d")).toBe(24);
		expect(periodHours("7d")).toBe(168);
		expect(periodHours("30d")).toBe(720);
		expect(periodHours("90d")).toBe(2160);
		expect(periodHours("365d")).toBe(8760);
	});

	it("老 hub（没有 history_days）按 7 天算 —— 正好是 1.15.x 时代那排", () => {
		setHistoryDays(undefined);
		expect(historyDays()).toBe(7);
		expect(periodsFor()).toEqual(["1d", "7d"]);
	});

	it("越界的保留天数会被钳到 1~365", () => {
		setHistoryDays(0);
		expect(historyDays()).toBe(1);
		setHistoryDays(9999);
		expect(historyDays()).toBe(365);
		setHistoryDays(30);
		expect(historyDays()).toBe(30);
	});
});

describe("备注合并成一串（私有在前、公有在后）", () => {
	it("私有在前（own=true）、公有在后（own=false）", () => {
		expect(
			remarkChips({ remark: "私有一,私有二", public_remark: "公开一,公开二" }),
		).toEqual([
			{ text: "私有一", own: true },
			{ text: "私有二", own: true },
			{ text: "公开一", own: false },
			{ text: "公开二", own: false },
		]);
	});

	it("私有那条先按换行分段、段内再按逗号拆（hub 对它没有单行约束）", () => {
		expect(remarkChips({ remark: "甲,乙\n丙，丁\n\n戊" })).toEqual([
			{ text: "甲", own: true },
			{ text: "乙", own: true },
			{ text: "丙", own: true },
			{ text: "丁", own: true },
			{ text: "戊", own: true },
		]);
	});

	it("访客（hub 不下发私有）→ 只剩公有那几枚", () => {
		expect(remarkChips({ public_remark: "只有公开" })).toEqual([
			{ text: "只有公开", own: false },
		]);
	});

	it("两边都没写 / 只有分隔符 → 空数组（页面零占位）", () => {
		expect(remarkChips({})).toEqual([]);
		expect(remarkChips({ remark: "  ,\n,  ", public_remark: "   " })).toEqual(
			[],
		);
	});
});

describe("备注显示位置（四档）", () => {
	it("四档取值与 theme.json 的选项逐字一致", () => {
		expect(REMARK_PLACEMENTS).toEqual(["both", "card", "detail", "none"]);
	});

	it("卡片侧与详情页侧各自独立，且都是**白名单**（none 档不许漏开）", () => {
		expect([
			remarksOnCards("both"),
			remarksOnCards("card"),
			remarksOnCards("detail"),
			remarksOnCards("none"),
		]).toEqual([true, true, false, false]);
		expect([
			remarksOnDetail("both"),
			remarksOnDetail("detail"),
			remarksOnDetail("card"),
			remarksOnDetail("none"),
		]).toEqual([true, true, false, false]);
	});
});

describe("私有备注的数据通路", () => {
	it("节点上的 remark 原样搬进视图模型（详情页那一块要的是原文）", () => {
		const server = toNezhaServer(
			{
				id: 1,
				name: "东京机",
				remark: "私有甲,私有乙\n第二行的一枚，带全角逗号",
			},
			Date.now(),
		);
		expect(server.remark).toBe("私有甲,私有乙\n第二行的一枚，带全角逗号");
	});

	it("没写私有备注 → 空串（详情页那一块零占位）", () => {
		const server = toNezhaServer({ id: 1, name: "东京机" }, Date.now());
		expect(server.remark).toBe("");
	});

	it("备注显示位置 = 只在详情页时，卡片侧的备注芯片不塞进 public_note（流量与账单照旧）", () => {
		const node = {
			id: 1,
			name: "东京机",
			public_remark: "公开甲,公开乙",
			traffic_limit: 1024 ** 4,
			traffic_reset_day: 1,
			expires_at: "2027-01-01",
			billing_cycle: "monthly",
			price: 12.5,
			currency: "CNY",
		};
		const onCard = JSON.parse(buildPublicNote(node, "both"));
		expect(onCard.planDataMod.bandwidth).toBe("公开甲");
		expect(onCard.planDataMod.extra).toBe("公开乙");
		expect(onCard.planDataMod.trafficVol).not.toBe("");
		const detailOnly = JSON.parse(buildPublicNote(node, "detail"));
		expect(detailOnly.planDataMod.bandwidth).toBe("");
		expect(detailOnly.planDataMod.extra).toBe("");
		// 流量配额与账单**不是备注**，卡片侧关掉备注时它们照旧
		expect(detailOnly.planDataMod.trafficVol).not.toBe("");
		expect(detailOnly.billingDataMod.amount).toBe("¥12.5");
	});

	it("公开备注不会顶替私有备注：它是另一条通路（卡片底部那排芯片用）", () => {
		const server = toNezhaServer(
			{ id: 1, name: "东京机", public_remark: "公开甲,公开乙" },
			Date.now(),
		);
		expect(server.remark).toBe("");
		expect(server.public_note).toContain("公开甲");
	});
});
