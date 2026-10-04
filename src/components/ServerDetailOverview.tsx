import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BackIcon } from "@/components/Icon";
import { ServerDetailLoading } from "@/components/loading/ServerDetailLoading";
import ServerFlag from "@/components/ServerFlag";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { formatBytes } from "@/lib/format";
import { cn, formatNezhaInfo } from "@/lib/utils";
import { getThemeConfig, remarkChips, remarksOnDetail } from "@/monitor/config";
import NumericText from "./NumericText";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./ui/tooltip";

export default function ServerDetailOverview({
	server_id,
}: {
	server_id: string;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();

	const [hasHistory, setHasHistory] = useState(false);

	useEffect(() => {
		const previousPath = sessionStorage.getItem("fromMainPage");
		if (previousPath) {
			setHasHistory(true);
		}

		return () => {
			if (previousPath) {
				sessionStorage.removeItem("fromMainPage");
			}
		};
	}, []);

	const { lastData, connected } = useWebSocketContext();

	if (!connected && !lastData) {
		return <ServerDetailLoading />;
	}

	const linkClick = () => {
		if (hasHistory) {
			navigate(-1);
		} else {
			navigate("/");
		}
	};

	const nezhaWsData = lastData;

	if (!nezhaWsData) {
		return <ServerDetailLoading />;
	}

	const server = nezhaWsData.servers.find((s) => s.id === Number(server_id));

	if (!server) {
		return <ServerDetailLoading />;
	}

	const {
		name,
		online,
		uptime,
		version,
		arch,
		mem_total,
		disk_total,
		country_code,
		platform,
		platform_version,
		cpu_info,
		load_1,
		load_5,
		load_15,
		net_out_transfer,
		net_in_transfer,
		last_active_time_string,
		boot_time_string,
	} = formatNezhaInfo(nezhaWsData.now, server);

	// 备注（见 @/monitor/config 的 remarkChips）：**私有在前（仅自己可见）、公有在后**，都拆成
	// 一枚枚小卡片。hub 只把私有备注下发给登录的管理员，所以访客在这块里看到的只有公有那几枚。
	// 「备注显示位置」决定这一页摊不摊（见 theme.json 的那个字段）。
	const chips = remarkChips(server);
	const detailChips = remarksOnDetail(getThemeConfig().remarkPlacement)
		? chips
		: [];

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	countries.registerLocale(enLocale);

	return (
		<div
			className={cn({
				"bg-card/70 p-4 rounded-[10px]": customBackgroundImage,
			})}
		>
			<div
				onClick={linkClick}
				className="flex flex-none cursor-pointer font-semibold leading-none items-center break-all tracking-tight gap-1 text-xl server-name"
			>
				<BackIcon />
				{name}
			</div>
			<section className="flex flex-wrap gap-2 mt-3">
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">
								{t("serverDetail.status")}
							</p>
							<Badge
								className={cn(
									"text-[9px] rounded-[6px] w-fit px-1 py-0 -mt-[0.3px] dark:text-white",
									{
										" bg-green-800": online,
										" bg-red-600": !online,
									},
								)}
							>
								{online ? t("serverDetail.online") : t("serverDetail.offline")}
							</Badge>
						</section>
					</CardContent>
				</Card>
				{online && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.uptime")}
								</p>
								<NumericText
									value={
										uptime / 86400 >= 1
											? `${Math.floor(uptime / 86400)} ${t("serverDetail.days")} ${Math.floor((uptime % 86400) / 3600)} ${t("serverDetail.hours")}`
											: `${Math.floor(uptime / 3600)} ${t("serverDetail.hours")}`
									}
									className="text-xs"
								/>
							</section>
						</CardContent>
					</Card>
				)}
				{version && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.version")}
								</p>
								<div className="text-xs">{version} </div>
							</section>
						</CardContent>
					</Card>
				)}
				{arch && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.arch")}
								</p>
								<div className="text-xs">{arch} </div>
							</section>
						</CardContent>
					</Card>
				)}

				{mem_total ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.mem")}
								</p>
								<div className="text-xs">{formatBytes(mem_total)}</div>
							</section>
						</CardContent>
					</Card>
				) : null}

				{disk_total ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.disk")}
								</p>
								<div className="text-xs">{formatBytes(disk_total)}</div>
							</section>
						</CardContent>
					</Card>
				) : null}

				{country_code && (
					<TooltipProvider delayDuration={100}>
						<Tooltip>
							<TooltipTrigger asChild>
								<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
									<CardContent className="px-1.5 py-1">
										<section className="flex flex-col items-start gap-0.5">
											<p className="text-xs text-muted-foreground">
												{t("serverDetail.region")}
											</p>
											<section className="flex items-start gap-1">
												<div className="text-xs text-start">
													{country_code?.toUpperCase()}
												</div>
												{country_code && (
													<ServerFlag
														className="text-[11px] -mt-px"
														country_code={country_code}
													/>
												)}
											</section>
										</section>
									</CardContent>
								</Card>
							</TooltipTrigger>
							<TooltipContent>
								<p>{countries.getName(country_code?.toUpperCase(), "en")}</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				)}
			</section>
			<section className="flex flex-wrap gap-2 mt-1">
				{platform && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.system")}
								</p>
								<div className="text-xs">
									{" "}
									{platform} {platform_version ? ` - ${platform_version}` : ""}
								</div>
							</section>
						</CardContent>
					</Card>
				)}
				{cpu_info.length > 0 && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">{"CPU"}</p>
								<div className="text-xs"> {cpu_info.join(", ")}</div>
							</section>
						</CardContent>
					</Card>
				)}
			</section>
			<section className="flex flex-wrap gap-2 mt-1">
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">{"Load"}</p>
							<div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
								{[
									{ label: "1m", value: load_1 },
									{ label: "5m", value: load_5 },
									{ label: "15m", value: load_15 },
								].map(({ label, value }) => (
									<div key={label} className="flex items-center gap-1">
										<span className="text-[10px] text-muted-foreground">
											{label}
										</span>
										<NumericText value={`${value}`} className="text-xs" />
									</div>
								))}
							</div>
						</section>
					</CardContent>
				</Card>
				{net_out_transfer ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.upload")}
								</p>
								{net_out_transfer ? (
									<NumericText
										value={formatBytes(net_out_transfer)}
										className="text-xs"
									/>
								) : (
									<div className="text-xs"> {t("serverDetail.unknown")}</div>
								)}
							</section>
						</CardContent>
					</Card>
				) : null}
				{net_in_transfer ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.download")}
								</p>
								{net_in_transfer ? (
									<NumericText
										value={formatBytes(net_in_transfer)}
										className="text-xs"
									/>
								) : (
									<div className="text-xs"> {t("serverDetail.unknown")}</div>
								)}
							</section>
						</CardContent>
					</Card>
				) : null}
			</section>

			<section className="flex flex-wrap gap-2 mt-1">
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">
								{t("serverDetail.bootTime")}
							</p>
							<div className="text-xs">
								{boot_time_string ? boot_time_string : "N/A"}
							</div>
						</section>
					</CardContent>
				</Card>
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">
								{t("serverDetail.lastActive")}
							</p>
							<NumericText
								value={
									last_active_time_string ? last_active_time_string : "N/A"
								}
								className="text-xs"
							/>
						</section>
					</CardContent>
				</Card>
			</section>

			{detailChips.length > 0 && (
				/* 整页详情那一块：**私有 + 公有合并成一串小卡片**，与 jikasei 1.19.1 同一套版式。
				   私有那几枚用描边 + 锁图标标成「仅自己可见」（hub 只把它下发给登录的管理员，所以
				   访客在这一块里只会看到公有那几枚——不需要两套分支）。
				   ★不加容器：没有底、没有描边、没有内边距，小卡片直接落在页面上（早先那层框是给
				   整段文字当底用的，改成小卡片之后它只是多余的一圈边）。没写备注时零占位。 */
				<section
					data-remark-block
					className="mt-3 flex min-w-0 flex-wrap items-center gap-1"
				>
					{detailChips.map((c, i) => (
						<Badge
							key={`${i}-${c.text}`}
							variant={c.own ? "outline" : "secondary"}
							className={
								"min-w-0 shrink font-normal " +
								(c.own ? "gap-1 text-muted-foreground" : "")
							}
							title={c.own ? t("serverDetail.privateRemark") : c.text}
						>
							{c.own && <Lock className="size-3 shrink-0" aria-hidden />}
							<span className="min-w-0 truncate">{c.text}</span>
						</Badge>
					))}
				</section>
			)}
		</div>
	);
}
