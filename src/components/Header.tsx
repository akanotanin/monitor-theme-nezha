import { useQuery } from "@tanstack/react-query";
import { ImageMinus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ModeToggle } from "@/components/ThemeSwitcher";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackground } from "@/hooks/use-background";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { fetchLoginUser, fetchSetting } from "@/lib/nezha-api";
import { cn } from "@/lib/utils";
import {
	applySiteIdentity,
	FALLBACK_ICON,
	ICON_CACHE_KEY,
} from "@/monitor/site-identity";

import AnimateCountClient from "./AnimatedCount";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Loader, LoadingSpinner } from "./loading/Loader";
import NumericText from "./NumericText";
import { SearchButton } from "./SearchButton";
import { Button } from "./ui/button";

// 标签页标题的缓存键，与 public/nezha-title-probe.js 里那个 KEY 必须一致（那个脚本在入口包
// 执行前就把站名贴上，靠的就是这个键）。用主题自己的键，避免同源上两个主题互相覆盖。
const TITLE_CACHE_KEY = "nezha:site_name";

interface TimeState {
	hh: number;
	mm: number;
	ss: number;
}

// 本地时间的三段数字。原先用 luxon 的 DateTime.now().hour/minute/second，
// 而 setLocale 只影响格式化、对这三个取值毫无作用 —— 为了页头那个时钟，
// 整个 luxon（69KB / gzip 22KB）被挂在首屏关键路径上。原生 Date 取值完全等价。
const nowTimeState = (): TimeState => {
	const now = new Date();
	return { hh: now.getHours(), mm: now.getMinutes(), ss: now.getSeconds() };
};

const useCurrentTime = () => {
	const [time, setTime] = useState<TimeState>(nowTimeState);

	useEffect(() => {
		const intervalId = setInterval(() => setTime(nowTimeState()), 1000);

		return () => clearInterval(intervalId);
	}, []);

	return time;
};

function Header() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { backgroundImage, updateBackground } = useBackground();

	const { data: settingData, isLoading } = useQuery({
		queryKey: ["setting"],
		queryFn: () => fetchSetting(),
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		retry: false,
	});

	const { lastData, connected } = useWebSocketContext();

	const onlineCount = connected ? (lastData ? lastData.online || 0 : 0) : "...";

	const siteName = settingData?.data?.config?.site_name;

	// @ts-expect-error CustomLogo is a global variable
	const customLogo = window.CustomLogo || "/apple-touch-icon.png";
	const logoRef = useRef<HTMLImageElement | null>(null);
	// 站长那张取不到时要换成主题自带那张 —— 换的是这张 <img> 的地址，不只是标签页图标
	const [logoSrc, setLogoSrc] = useState(customLogo);

	const customMobileBackgroundImage =
		window.CustomMobileBackgroundImage !== ""
			? window.CustomMobileBackgroundImage
			: undefined;

	// 站点图标统一交给 src/monitor/site-identity.ts 落地（标签页 + iOS 主屏 + PWA 清单）。
	// 这里只做两件事：等顶栏这张**真的加载成功**再改，以及把成功的地址记进缓存。
	//
	// - 为什么非要等加载成功：同一个地址在页面加载期被并发拉两条时，弱链路上两条会互相踩，
	//   页头那张会当场失败、顶栏图标整块消失（别处实测过约 1/5 成功率）。
	// - 为什么记进 localStorage：给 public/nezha-icon-probe.js 用 —— 下次加载它抢在浏览器
	//   去取 favicon 之前就把地址贴上，既不闪主题自带那张，也不用等入口包。
	// - 为什么用 logoSrc 而不是 customLogo：站长那张挂掉、已退回主题自带那张之后，
	//   退回的那张加载成功若还去写 customLogo，会把坏地址改回页面、还写进缓存（踩过）。
	const acceptLogo = useCallback(() => {
		applySiteIdentity({ icon: logoSrc });
		try {
			if (logoSrc === customLogo) localStorage.setItem(ICON_CACHE_KEY, logoSrc);
			else localStorage.removeItem(ICON_CACHE_KEY);
		} catch {
			// 隐私模式 / 存储被禁用：图标照改，只是下次加载会先回到主题自带那张
		}
	}, [logoSrc, customLogo]);

	const dropLogo = useCallback(() => {
		// 站长填的地址取不到：顶栏这张也退回主题自带那张（别只让标签页退、页头留个破图）。
		// 退回那张加载成功会再走一次 acceptLogo，那时 logoSrc 已不是站长那张 → 不写缓存。
		setLogoSrc(FALLBACK_ICON);
	}, []);

	useEffect(() => {
		// onLoad 有可能赶不上（图命中内存缓存、元素挂上时就已经 complete），补一次
		const img = logoRef.current;
		if (img?.complete && img.naturalWidth > 0) acceptLogo();
	}, [acceptLogo]);

	// 站名由站长在后台改，而 /api/me（桥接到哪吒的 setting）没回来时手上只有兜底值——
	// 所以数据没到就不写标题：写一次就只能写对一次，否则访客会看到「主题名 → 兜底名 → 站名」三跳。
	useEffect(() => {
		if (!settingData) return;
		const title = siteName || "哪吒监控 Nezha Monitoring";
		// 宣告标题归 React 管：index.html 里的 nezha-title-probe.js 冷启动时会自己去问一次 /api/me，
		// 那条迟到的响应不许把这里写好的标题改回去。
		(window as unknown as { __titleOwned?: boolean }).__titleOwned = true;
		document.title = title;
		// 站名还要落到 iOS 主屏名与 PWA 清单上（清单是静态文件，这一句是唯一能改它的地方）
		applySiteIdentity({ name: title });
		try {
			// 记给下一次刷新用（nezha-title-probe.js 贴的就是它）。
			localStorage.setItem(TITLE_CACHE_KEY, title);
		} catch {
			// 隐私模式 / 存储被禁用：标题照写，只是下次刷新会先回到占位值。
		}
	}, [settingData, siteName]);

	const handleBackgroundToggle = () => {
		if (window.CustomBackgroundImage) {
			// Store the current background image before removing it
			sessionStorage.setItem(
				"savedBackgroundImage",
				window.CustomBackgroundImage,
			);
			updateBackground(undefined);
		} else {
			// Restore the saved background image
			const savedImage = sessionStorage.getItem("savedBackgroundImage");
			if (savedImage) {
				updateBackground(savedImage);
			}
		}
	};

	const customBackgroundImage = backgroundImage;

	return (
		<div className="mx-auto w-full max-w-5xl">
			<section className="flex items-center justify-between header-top">
				<section
					onClick={() => {
						sessionStorage.removeItem("selectedGroup");
						navigate("/");
					}}
					className="cursor-pointer flex items-center text-[15px] font-semibold tracking-[-0.01em] sm:text-lg"
				>
					<div className="mr-1.5 flex flex-row items-center justify-start header-logo">
						<img
							ref={logoRef}
							width={40}
							height={40}
							alt=""
							src={logoSrc}
							onLoad={acceptLogo}
							onError={dropLogo}
							className="relative m-0! border-2 border-transparent h-7 w-7 object-cover object-top p-0!"
						/>
					</div>
					{isLoading ? (
						<Skeleton className="h-[18px] w-24 rounded-[5px] bg-muted-foreground/10 animate-none" />
					) : (
						siteName || "NEZHA"
					)}
				</section>
				<section className="flex items-center gap-2 header-handles">
					<div className="hidden sm:flex items-center gap-2">
						<Links />
						<DashboardLink />
					</div>
					<SearchButton />
					<LanguageSwitcher />
					<ModeToggle />
					{(customBackgroundImage ||
						sessionStorage.getItem("savedBackgroundImage")) && (
						<Button
							variant="outline"
							size="sm"
							onClick={handleBackgroundToggle}
							className={cn("rounded-full px-[9px] bg-white dark:bg-black", {
								"bg-white/70 dark:bg-black/70": customBackgroundImage,
								"hidden sm:block": customMobileBackgroundImage,
							})}
						>
							<ImageMinus className="w-4 h-4" />
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						className={cn(
							"hover:bg-white dark:hover:bg-black cursor-default rounded-full flex items-center px-[9px] bg-white dark:bg-black",
							{
								"bg-white/70 dark:bg-black/70": customBackgroundImage,
							},
						)}
					>
						{connected ? (
							<NumericText value={onlineCount} />
						) : (
							<Loader visible={true} />
						)}
						<p className="text-muted-foreground">
							{connected ? t("online") : t("offline")}
						</p>
						<span
							className={cn("h-2 w-2 rounded-full bg-green-500", {
								"bg-red-500": !connected,
							})}
						></span>
					</Button>
				</section>
			</section>
			<div className="w-full flex justify-between sm:hidden mt-1">
				<DashboardLink />
				<Links />
			</div>
			<Overview />
		</div>
	);
}

type links = {
	link: string;
	name: string;
};

function parseCustomLinks(customLinks: string | undefined): links[] | null {
	if (!customLinks) return null;

	try {
		const parsedLinks = JSON.parse(customLinks);

		if (!Array.isArray(parsedLinks)) {
			return null;
		}

		return parsedLinks.filter(
			(link): link is links =>
				typeof link?.link === "string" && typeof link?.name === "string",
		);
	} catch {
		return null;
	}
}

function Links() {
	// @ts-expect-error CustomLinks is a global variable
	const customLinks = window.CustomLinks as string;

	const links = parseCustomLinks(customLinks);

	if (!links) return null;

	return (
		<div className="flex items-center gap-2 w-fit">
			{links.map((link, index) => {
				return (
					<a
						key={index}
						href={link.link}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 text-sm font-medium opacity-50 transition-opacity hover:opacity-100"
					>
						{link.name}
					</a>
				);
			})}
		</div>
	);
}

export function RefreshToast() {
	const { t } = useTranslation();
	const navigate = useNavigate();

	const { needReconnect } = useWebSocketContext();

	if (!needReconnect) {
		return null;
	}

	if (needReconnect) {
		sessionStorage.removeItem("needRefresh");
		setTimeout(() => {
			navigate(0);
		}, 1000);
	}

	return (
		<div className="refresh-toast-animate fixed left-1/2 -translate-x-1/2 top-8 z-999 flex items-center justify-between gap-4 rounded-[50px] border border-solid bg-white px-2 py-1.5 shadow-xl shadow-black/5 dark:border-stone-700 dark:bg-stone-800 dark:shadow-none">
			<section className="flex items-center gap-1.5">
				<LoadingSpinner />
				<p className="text-[12.5px] font-medium">{t("refreshing")}...</p>
			</section>
		</div>
	);
}

function DashboardLink() {
	const { t } = useTranslation();
	const { setNeedReconnect } = useWebSocketContext();
	const previousLoginState = useRef<boolean | null>(null);
	const {
		data: userData,
		isFetched,
		isLoadingError,
		isError,
		refetch,
	} = useQuery({
		queryKey: ["login-user"],
		queryFn: () => fetchLoginUser(),
		refetchOnMount: false,
		refetchOnWindowFocus: true,
		refetchIntervalInBackground: true,
		refetchInterval: 1000 * 30,
		retry: 0,
	});

	const isLogin = isError
		? false
		: userData
			? !!userData?.data?.id && !!document.cookie
			: false;

	if (isLoadingError) {
		previousLoginState.current = isLogin;
	}

	useEffect(() => {
		refetch();
	}, [refetch]);

	useEffect(() => {
		if (isFetched || isError) {
			// 只有当登录状态发生变化时才设置needReconnect
			if (
				previousLoginState.current !== null &&
				previousLoginState.current !== isLogin
			) {
				setNeedReconnect(true);
			}
			previousLoginState.current = isLogin;
		}
	}, [isLogin, isError, isFetched, setNeedReconnect]);

	return (
		<div className="flex items-center gap-2">
			<a
				href={"/admin/"}
				rel="noopener noreferrer"
				className="flex items-center text-nowrap gap-1 text-sm font-medium opacity-50 transition-opacity hover:opacity-100"
			>
				{!isLogin && t("login")}
				{isLogin && t("dashboard")}
			</a>
		</div>
	);
}

function Overview() {
	const { t } = useTranslation();
	const time = useCurrentTime();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<section className={"mt-10 flex flex-col md:mt-16 header-timer"}>
			<p className="text-base font-semibold">👋 {t("overview")}</p>
			<div className="flex items-center gap-1">
				<p className="text-sm font-medium opacity-50">{t("whereTheTimeIs")}</p>
				{mounted ? (
					<div className="flex items-center font-medium text-sm">
						<AnimateCountClient count={time.hh} minDigits={2} />
						<span className="mb-px font-medium text-sm opacity-50">:</span>
						<AnimateCountClient count={time.mm} minDigits={2} />
						<span className="mb-px font-medium text-sm opacity-50">:</span>
						<span className="font-medium text-sm">
							<AnimateCountClient count={time.ss} minDigits={2} />
						</span>
					</div>
				) : (
					<Skeleton className="h-[21px] w-16 animate-none rounded-[5px] bg-muted-foreground/10" />
				)}
			</div>
		</section>
	);
}
export default Header;
