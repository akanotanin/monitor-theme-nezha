import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "./App";
import { ThemeColorManager } from "./components/ThemeColorManager";
import { ThemeProvider } from "./components/ThemeProvider";
import { CommandProvider } from "./context/command-provider";
import { SortProvider } from "./context/sort-provider";
import { StatusProvider } from "./context/status-provider";
import { TooltipProvider } from "./context/tooltip-provider";
import { WebSocketProvider } from "./context/websocket-provider";
// 词条按需加载：默认语言与兜底语言在包里，其余 12 种拉 chunk（见 src/i18n.js）
import i18n, { ensureLocale } from "./i18n";
import "./index.css";
import { applyWindowGlobals, loadThemeConfig } from "./monitor/config";
import { endpoints } from "./monitor/endpoints";

const queryClient = new QueryClient();
const ReactQueryDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-query-devtools").then((module) => ({
				default: module.ReactQueryDevtools,
			})),
		)
	: null;

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element not found");
}

/**
 * 上游那些站点级开关（`window.ForceShowMap` 之类）原本由哪吒的服务端模板注入，
 * 极简探针的主题包是纯静态文件、没有模板可注入，于是改由主题设置下发：这里先取
 * 主题配置写回 window，再挂载 React —— 先把值放好，首屏就不会读到空。
 */
async function boot() {
	const config = await loadThemeConfig();
	applyWindowGlobals(config);

	// 上游是 App.tsx 从哪吒后端设置里取 language 再 changeLanguage；探针没有这份站点设置，
	// 改从主题设置取。访客在页头自己切过语言（localStorage 里有值）就以访客为准 —— 同上游判断。
	const preferred =
		config.language && !localStorage.getItem("language")
			? config.language
			: i18n.language;
	// ★先把要用的那种词条拉进来（其余 12 种按需加载，见 src/i18n.js），再挂载 React ——
	// 否则首帧会用兜底语言（英语）渲染一遍、下一帧才跳成中文。拉不到就用兜底语言，不拦页面。
	await ensureLocale(preferred);
	if (preferred !== i18n.language) {
		await i18n.changeLanguage(preferred);
	}

	ReactDOM.createRoot(rootElement as HTMLElement).render(
		<ThemeProvider storageKey="vite-ui-theme">
			<ThemeColorManager />
			<QueryClientProvider client={queryClient}>
				<WebSocketProvider url={endpoints.ws}>
					<CommandProvider>
						<StatusProvider>
							<SortProvider>
								<TooltipProvider>
									<App />
									<Toaster
										duration={1000}
										toastOptions={{
											classNames: {
												default:
													"w-fit rounded-full px-2.5 py-1.5 bg-neutral-100 border border-neutral-200 backdrop-blur-xl shadow-none",
											},
										}}
										position="top-center"
										className={"flex items-center justify-center"}
									/>
									{ReactQueryDevtools ? (
										<Suspense fallback={null}>
											<ReactQueryDevtools />
										</Suspense>
									) : null}
								</TooltipProvider>
							</SortProvider>
						</StatusProvider>
					</CommandProvider>
				</WebSocketProvider>
			</QueryClientProvider>
		</ThemeProvider>,
	);
}

boot();
