import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "@/context/command-provider";
import { SortProvider } from "@/context/sort-provider";
import { StatusProvider } from "@/context/status-provider";
import { TooltipProvider } from "@/context/tooltip-provider";
import { WebSocketProvider } from "@/context/websocket-provider";
import { useCommand } from "@/hooks/use-command";
import { useSort } from "@/hooks/use-sort";
import { useStatus } from "@/hooks/use-status";
import { useTooltip } from "@/hooks/use-tooltip";
import { useWebSocketContext } from "@/hooks/use-websocket-context";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly url: string;
	readyState = FakeWebSocket.CONNECTING;
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	open() {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	message(data: string) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}

	close() {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close"));
	}
}

function CommandProbe() {
	const { closeCommand, isOpen, openCommand, toggleCommand } = useCommand();

	return (
		<div>
			<p data-testid="command-state">{isOpen ? "open" : "closed"}</p>
			<button type="button" onClick={openCommand}>
				open
			</button>
			<button type="button" onClick={closeCommand}>
				close
			</button>
			<button type="button" onClick={toggleCommand}>
				toggle
			</button>
		</div>
	);
}

function SortProbe() {
	const { setSortOrder, setSortType, sortOrder, sortType } = useSort();

	return (
		<div>
			<p>{`${sortType}:${sortOrder}`}</p>
			<button type="button" onClick={() => setSortType("cpu")}>
				cpu
			</button>
			<button type="button" onClick={() => setSortOrder("asc")}>
				asc
			</button>
		</div>
	);
}

function StatusProbe() {
	const { setStatus, status } = useStatus();

	return (
		<div>
			<p data-testid="status-state">{status}</p>
			<button type="button" onClick={() => setStatus("online")}>
				online
			</button>
		</div>
	);
}

function TooltipProbe() {
	const { setTooltipData, tooltipData } = useTooltip();

	return (
		<div>
			<p>{tooltipData?.country ?? "empty"}</p>
			<button
				type="button"
				onClick={() =>
					setTooltipData({
						centroid: [10, 20],
						country: "China",
						count: 1,
						servers: [{ id: 1, name: "edge", status: true }],
					})
				}
			>
				show
			</button>
		</div>
	);
}

function WebSocketProbe() {
	const {
		connected,
		lastData,
		messageHistory,
		needReconnect,
		setNeedReconnect,
	} = useWebSocketContext();

	return (
		<div>
			<p>{connected ? "connected" : "disconnected"}</p>
			<p>{lastData?.servers[0]?.name ?? "none"}</p>
			<p data-testid="message-count">{messageHistory.length}</p>
			<p data-testid="history-server-count">
				{messageHistory.reduce((total, item) => total + item.servers.length, 0)}
			</p>
			<p>{needReconnect ? "needs-reconnect" : "stable"}</p>
			<button type="button" onClick={() => setNeedReconnect(true)}>
				mark
			</button>
		</div>
	);
}

describe("state providers", () => {
	it("manages command palette open state", async () => {
		const user = userEvent.setup();
		render(
			<CommandProvider>
				<CommandProbe />
			</CommandProvider>,
		);

		expect(screen.getByTestId("command-state")).toHaveTextContent("closed");
		await user.click(screen.getByRole("button", { name: "open" }));
		expect(screen.getByTestId("command-state")).toHaveTextContent("open");
		await user.click(screen.getByRole("button", { name: "toggle" }));
		expect(screen.getByTestId("command-state")).toHaveTextContent("closed");
		await user.click(screen.getByRole("button", { name: "open" }));
		await user.click(screen.getByRole("button", { name: "close" }));
		expect(screen.getByTestId("command-state")).toHaveTextContent("closed");
	});

	it("uses forced sort globals when valid and still allows local updates", async () => {
		window.ForceSortType = "mem";
		window.ForceSortOrder = "asc";
		const user = userEvent.setup();
		render(
			<SortProvider>
				<SortProbe />
			</SortProvider>,
		);

		expect(screen.getByText("mem:asc")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "cpu" }));
		expect(screen.getByText("cpu:asc")).toBeInTheDocument();
	});

	it("falls back to default sort values for invalid forced globals", () => {
		window.ForceSortType = "invalid";
		window.ForceSortOrder = "up";

		render(
			<SortProvider>
				<SortProbe />
			</SortProvider>,
		);

		expect(screen.getByText("default:desc")).toBeInTheDocument();
	});

	it("manages server status filters", async () => {
		const user = userEvent.setup();
		render(
			<StatusProvider>
				<StatusProbe />
			</StatusProvider>,
		);

		expect(screen.getByTestId("status-state")).toHaveTextContent("all");
		await user.click(screen.getByRole("button", { name: "online" }));
		expect(screen.getByTestId("status-state")).toHaveTextContent("online");
	});

	it("stores map tooltip data", async () => {
		const user = userEvent.setup();
		render(
			<TooltipProvider>
				<TooltipProbe />
			</TooltipProvider>,
		);

		expect(screen.getByText("empty")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "show" }));
		expect(screen.getByText("China")).toBeInTheDocument();
	});
});

describe("context hooks", () => {
	it("throws helpful errors when strict hooks miss their providers", () => {
		expect(() => renderHook(() => useCommand())).toThrow(
			"useCommand must be used within a CommandProvider",
		);
		expect(() => renderHook(() => useSort())).toThrow(
			"useStatus must be used within a SortProvider",
		);
		expect(() => renderHook(() => useStatus())).toThrow(
			"useStatus must be used within a StatusProvider",
		);
		expect(() => renderHook(() => useTooltip())).toThrow(
			"useTooltip must be used within a TooltipProvider",
		);
	});
});

describe("WebSocketProvider", () => {
	beforeEach(() => {
		FakeWebSocket.instances = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
	});

	function renderWebSocketProvider(children: ReactNode) {
		return render(
			<WebSocketProvider url="/api/v1/ws/server">{children}</WebSocketProvider>,
		);
	}

	/**
	 * 探针推的帧是 `{admin, nodes}`（与 `/api/nodes` 同一个形状），provider 负责翻成上游的
	 * `{now, online, servers}` 视图模型 —— 所以这里要喂**探针**的形状，不是上游的。
	 */
	function websocketPayload(serverName: string) {
		return JSON.stringify({
			admin: false,
			nodes: [
				{
					id: 1,
					name: serverName,
					group: "默认",
					country: "US",
					os: "Debian GNU/Linux 12 (bookworm)",
					arch: "x86_64",
					online: true,
					public: true,
					last_seen: Math.floor(Date.now() / 1000),
					mem_total: 1020526592,
					disk_total: 10485864448,
					metrics: {
						cpu: 12,
						mem_used: 431800320,
						mem_total: 1020526592,
						disk_used: 1524510720,
						disk_total: 10485864448,
						net_rx: 867,
						net_tx: 465,
						uptime: 318521,
					},
				},
			],
		});
	}

	it("connects with a ws URL and records incoming messages", () => {
		renderWebSocketProvider(<WebSocketProbe />);

		const socket = FakeWebSocket.instances[0];
		expect(socket.url).toBe("wss://localhost/api/v1/ws/server");

		act(() => {
			socket.open();
		});
		expect(screen.getByText("connected")).toBeInTheDocument();

		act(() => {
			socket.message(websocketPayload("first"));
			socket.message(websocketPayload("second"));
		});

		expect(screen.getByText("second")).toBeInTheDocument();
		expect(screen.getByTestId("message-count")).toHaveTextContent("2");
	});

	it("normalizes missing and non-array server collections", () => {
		renderWebSocketProvider(<WebSocketProbe />);
		const socket = FakeWebSocket.instances[0];
		act(() => {
			socket.open();
			// 探针的帧少了 nodes、nodes 是 null、nodes 不是数组 —— 三种都该落成「零台服务器」。
			socket.message(JSON.stringify({ admin: false }));
			socket.message(JSON.stringify({ admin: false, nodes: null }));
			socket.message(
				JSON.stringify({ admin: false, nodes: { invalid: true } }),
			);
		});

		expect(screen.getByText("none")).toBeInTheDocument();
		expect(screen.getByTestId("message-count")).toHaveTextContent("3");
		expect(screen.getByTestId("history-server-count")).toHaveTextContent("0");
	});

	it("keeps only the latest thirty websocket messages", () => {
		renderWebSocketProvider(<WebSocketProbe />);
		const socket = FakeWebSocket.instances[0];

		act(() => {
			socket.open();
			for (let index = 0; index < 31; index += 1) {
				socket.message(websocketPayload(`message-${index}`));
			}
		});

		expect(screen.getByText("message-30")).toBeInTheDocument();
		expect(screen.getByTestId("message-count")).toHaveTextContent("30");
	});

	it("ignores malformed websocket messages without disconnecting", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		renderWebSocketProvider(<WebSocketProbe />);
		const socket = FakeWebSocket.instances[0];

		act(() => {
			socket.open();
			socket.message("not-json");
		});

		expect(screen.getByText("connected")).toBeInTheDocument();
		expect(screen.getByText("none")).toBeInTheDocument();
		expect(screen.getByTestId("message-count")).toHaveTextContent("0");
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to parse WebSocket message:",
			expect.any(SyntaxError),
		);
	});

	it("ignores websocket messages without a valid response shape", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		renderWebSocketProvider(<WebSocketProbe />);
		const socket = FakeWebSocket.instances[0];

		act(() => {
			socket.open();
			socket.message("null");
			socket.message(JSON.stringify([1, 2]));
		});

		expect(screen.getByTestId("message-count")).toHaveTextContent("0");
		expect(consoleError).toHaveBeenCalledTimes(2);
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to parse frame:",
			expect.any(TypeError),
		);
	});

	it("exposes manual reconnect state separately from socket state", async () => {
		const user = userEvent.setup();
		renderWebSocketProvider(<WebSocketProbe />);

		expect(screen.getByText("stable")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "mark" }));
		expect(screen.getByText("needs-reconnect")).toBeInTheDocument();
	});
});
