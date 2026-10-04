import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getThemeConfig, remarkChips, remarksOnCards } from "@/monitor/config";
import type { NezhaServer } from "@/types/nezha-api";

/**
 * 卡片上的**私有备注**（hub 只把它下发给登录的管理员，所以访客这边什么都不渲染）。
 *
 * 公开备注在卡片上走的是另一条路：它是「标签规则」没匹配到时的兜底来源，按套餐芯片渲染
 * （带宽 / IPv4 / IPv6 / 灰标签，见 src/monitor/mapping.ts 的 buildPublicNote）。私有那条
 * 不进那套芯片 —— 与套餐标签混成一样就分不出「这是站长写给自己的」。这里照详情页的口径
 * 单独摊一排（描边 + 锁 = 仅自己可见），用的是卡片自己的小芯片尺寸。
 *
 * 「备注显示位置」把卡片侧关掉时（`detail` / `none`）整块不渲染（与公开那几枚同一个开关）。
 */
export function CardRemarks({
	serverInfo,
	/** 卡片视图居中；紧凑列表由调用方传 "start" 靠左（与 PlanInfo 同一套对齐口径）。 */
	align = "center",
}: {
	serverInfo: NezhaServer;
	align?: "center" | "start";
}) {
	const { t } = useTranslation();
	const own = remarksOnCards(getThemeConfig().remarkPlacement)
		? remarkChips(serverInfo).filter((chip) => chip.own)
		: [];
	if (own.length === 0) return null;

	const label = t("serverDetail.privateRemark");

	return (
		<section
			data-card-remarks
			className={cn(
				"flex w-full flex-wrap items-center gap-1 mt-0.5",
				align === "center" ? "justify-center" : "justify-start",
			)}
		>
			{own.map((chip, index) => (
				<p
					key={`${index}-${chip.text}`}
					title={label}
					className="flex w-fit items-center gap-0.5 rounded-[5px] border border-stone-400/70 px-[3px] py-[1.5px] text-[9px] text-stone-500 dark:border-stone-600 dark:text-stone-400"
				>
					<Lock className="size-[9px] shrink-0" aria-hidden />
					<span className="max-w-[9rem] truncate">{chip.text}</span>
				</p>
			))}
		</section>
	);
}
