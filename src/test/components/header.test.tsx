import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header, { RefreshToast } from "@/components/Header";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandProvider } from "@/context/command-provider";
import { createSettingResponse } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/utils";

const headerMocks = vi.hoisted(() => ({
	backgroundImage: undefined as string | undefined,
	connected: true,
	fetchLoginUser: vi.fn(),
	fetchSetting: vi.fn(),
	lastData: null as { now: number; online?: number; servers: [] } | null,
	needReconnect: false,
	setNeedReconnect: vi.fn(),
	updateBackground: vi.fn(),
}));

vi.mock("@/hooks/use-background", () => ({
	useBackground: () => ({
		backgroundImage: headerMocks.backgroundImage,
		updateBackground: headerMocks.updateBackground,
	}),
}));

vi.mock("@/hooks/use-websocket-context", () => ({
	useWebSocketContext: () => ({
		connected: headerMocks.connected,
		lastData: headerMocks.lastData,
		needReconnect: headerMocks.needReconnect,
		setNeedReconnect: headerMocks.setNeedReconnect,
	}),
}));

vi.mock("@/lib/nezha-api", () => ({
	fetchLoginUser: headerMocks.fetchLoginUser,
	fetchSetting: headerMocks.fetchSetting,
}));

function settingResponse(siteName = "Nezha") {
	return {
		...createSettingResponse(),
		data: {
			...createSettingResponse().data,
			config: {
				...createSettingResponse().data.config,
				site_name: siteName,
			},
		},
	};
}

function loginResponse() {
	return {
		success: true,
		data: {
			id: 1,
			username: "admin",
			password: "",
			created_at: "2025-01-01T00:00:00.000Z",
			updated_at: "2025-01-01T00:00:00.000Z",
		},
	};
}

function LocationProbe() {
	const location = useLocation();
	return <p>{location.pathname}</p>;
}

function renderHeader(route = "/server/1") {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<MemoryRouter initialEntries={[route]}>
				<ThemeProvider storageKey="header-theme-test">
					<CommandProvider>
						<Header />
						<LocationProbe />
					</CommandProvider>
				</ThemeProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

function renderInRouter(ui: ReactElement) {
	return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("Header", () => {
	beforeEach(() => {
		headerMocks.backgroundImage = undefined;
		headerMocks.connected = true;
		headerMocks.fetchLoginUser.mockReset();
		headerMocks.fetchSetting.mockReset();
		headerMocks.lastData = {
			now: Date.parse("2025-01-01T00:00:20.000Z"),
			online: 4,
			servers: [],
		};
		headerMocks.needReconnect = false;
		headerMocks.setNeedReconnect.mockReset();
		headerMocks.updateBackground.mockReset();
		Object.assign(window, {
			CustomBackgroundImage: "",
			CustomLinks: "",
			CustomLogo: "",
			CustomMobileBackgroundImage: "",
		});
		headerMocks.fetchSetting.mockResolvedValue(settingResponse());
		headerMocks.fetchLoginUser.mockRejectedValue(new Error("anonymous"));
	});

	it("renders configured site identity, custom links, online count, and dashboard state", async () => {
		const user = userEvent.setup();
		Object.assign(window, {
			CustomLinks: JSON.stringify([
				{ link: "https://example.test", name: "Docs" },
			]),
			CustomLogo: "/logo.png",
		});
		Object.defineProperty(document, "cookie", {
			configurable: true,
			value: "session=1",
		});
		sessionStorage.setItem("selectedGroup", "Edge");
		headerMocks.fetchSetting.mockResolvedValue(settingResponse("Status Hub"));
		headerMocks.fetchLoginUser.mockResolvedValue(loginResponse());

		renderHeader();

		const siteName = await screen.findByText("Status Hub");
		// alt 已置空（装饰性 logo，紧跟站名文字），不能再按 alt 文本查它
		const logo = document.querySelector(".header-logo img") as HTMLImageElement;
		expect(logo).toHaveAttribute("src", "/logo.png");
		expect(logo).toHaveAttribute("alt", "");
		expect(screen.getAllByRole("link", { name: "Docs" })).toHaveLength(2);
		expect(await screen.findAllByText("dashboard")).toHaveLength(2);
		expect(screen.getByText("online").closest("button")).toHaveTextContent("4");
		expect(screen.getByText("online")).toBeInTheDocument();

		await waitFor(() => {
			expect(document.title).toBe("Status Hub");
		});
		// 图标链是「等真的加载成功才落」——jsdom 不会真的加载图片，这里手动触发一次 load 来模拟加载成功
		// （rel 已是规范的 "icon"，"shortcut" 是过期写法）
		fireEvent.load(logo);
		await waitFor(() => {
			expect(document.querySelector("link[rel='icon']")).toHaveAttribute(
				"href",
				"/logo.png",
			);
		});

		await user.click(siteName);

		expect(sessionStorage.getItem("selectedGroup")).toBeNull();
		expect(screen.getByText("/")).toBeInTheDocument();
	});

	it("数据没到之前不碰标题，到了才写一次并把站名记给刷新用", async () => {
		let resolveSetting: ((value: unknown) => void) | undefined;
		headerMocks.fetchSetting.mockReturnValue(
			new Promise((resolve) => {
				resolveSetting = resolve;
			}),
		);
		// 静态 HTML 留下的占位值（index.html 里那句）：数据没到时谁都不许改写它。
		document.title = "哪吒监控 Nezha Monitoring";
		localStorage.removeItem("nezha-dash:site_name");
		// 上一个用例已经置过这个标志（同一个 jsdom window），先摘掉再验。
		delete (window as unknown as { __titleOwned?: boolean }).__titleOwned;

		renderHeader();

		await waitFor(() => expect(headerMocks.fetchSetting).toHaveBeenCalled());
		expect(document.title).toBe("哪吒监控 Nezha Monitoring");
		expect(
			(window as unknown as { __titleOwned?: boolean }).__titleOwned,
		).toBeUndefined();

		resolveSetting?.(settingResponse("Status Hub"));

		await waitFor(() => expect(document.title).toBe("Status Hub"));
		// 置了「标题归 React 管」的标志（那条早问的迟到响应据此退让），并把站名记下来供刷新用。
		expect((window as unknown as { __titleOwned?: boolean }).__titleOwned).toBe(
			true,
		);
		expect(localStorage.getItem("nezha-dash:site_name")).toBe("Status Hub");
	});

	it("uses the offline display and login links when websocket and auth are unavailable", async () => {
		headerMocks.connected = false;

		const { container } = renderHeader();

		expect(await screen.findAllByText("login")).toHaveLength(2);
		expect(screen.getByText("offline")).toBeInTheDocument();
		expect(
			container.querySelector("[data-visible='true']"),
		).toBeInTheDocument();
	});

	it("ignores invalid custom links instead of crashing", async () => {
		Object.assign(window, {
			CustomLinks: "{bad-json",
		});

		renderHeader();

		expect(await screen.findByText("Nezha")).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Docs" }),
		).not.toBeInTheDocument();
	});

	it("stores and removes the active custom background", async () => {
		const user = userEvent.setup();
		headerMocks.backgroundImage = "/desktop.png";
		Object.assign(window, {
			CustomBackgroundImage: "/desktop.png",
			CustomMobileBackgroundImage: "/mobile.png",
		});

		const { container } = renderHeader();
		await screen.findByText("Nezha");

		const toggleButton = container
			.querySelector(".lucide-image-minus")
			?.closest("button");
		expect(toggleButton).toBeInTheDocument();

		await user.click(toggleButton as HTMLButtonElement);

		expect(sessionStorage.getItem("savedBackgroundImage")).toBe("/desktop.png");
		expect(headerMocks.updateBackground).toHaveBeenCalledWith(undefined);
	});

	it("restores the saved custom background", async () => {
		const user = userEvent.setup();
		sessionStorage.setItem("savedBackgroundImage", "/saved.png");

		const { container } = renderHeader();
		await screen.findByText("Nezha");

		const toggleButton = container
			.querySelector(".lucide-image-minus")
			?.closest("button");
		expect(toggleButton).toBeInTheDocument();

		await user.click(toggleButton as HTMLButtonElement);

		expect(headerMocks.updateBackground).toHaveBeenCalledWith("/saved.png");
	});
});

describe("RefreshToast", () => {
	beforeEach(() => {
		headerMocks.needReconnect = false;
	});

	it("renders only while reconnect refresh is needed", () => {
		vi.useFakeTimers();
		sessionStorage.setItem("needRefresh", "true");

		const { container, rerender } = renderInRouter(<RefreshToast />);

		expect(container).toBeEmptyDOMElement();

		headerMocks.needReconnect = true;
		rerender(
			<MemoryRouter>
				<RefreshToast />
			</MemoryRouter>,
		);

		expect(screen.getByText("refreshing...")).toBeInTheDocument();
		expect(sessionStorage.getItem("needRefresh")).toBeNull();
	});
});
