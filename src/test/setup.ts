import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("react-i18next", () => ({
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: {
			language: "en-US",
			languages: ["en-US"],
			changeLanguage: vi.fn(),
		},
	}),
}));

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

class IntersectionObserverMock {
	readonly root = null;
	readonly rootMargin = "";
	readonly thresholds = [];

	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
	takeRecords = vi.fn(() => []);
}

Object.defineProperty(globalThis, "ResizeObserver", {
	writable: true,
	value: ResizeObserverMock,
});

Object.defineProperty(globalThis, "IntersectionObserver", {
	writable: true,
	value: IntersectionObserverMock,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
	configurable: true,
	value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
	configurable: true,
	value: vi.fn(() => false),
});

Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
	configurable: true,
	value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
	configurable: true,
	value: vi.fn(),
});

/**
 * 每个测试文件一份**内存版** localStorage / sessionStorage。
 *
 * 为什么必须：Node 26 有实验性的全局 `localStorage`（还能用 `--localstorage-file` 落到文件上），
 * 它会盖过 jsdom 那份，于是同一个 worker 里的测试文件**共用一份存储** ——
 * 症状是「单跑绿、全量跑红，而且失败名单每次换人」（本轮实测：全量 13 红 / 单跑只剩 8 红）。
 * 换成内存实现之后，全量与单跑的结论一致，也不需要再给 vitest 塞 NODE_OPTIONS。
 */
class MemoryStorage implements Storage {
	private store = new Map<string, string>();

	get length(): number {
		return this.store.size;
	}

	clear(): void {
		this.store.clear();
	}

	getItem(key: string): string | null {
		return this.store.has(key) ? (this.store.get(key) as string) : null;
	}

	key(index: number): string | null {
		return [...this.store.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	setItem(key: string, value: string): void {
		this.store.set(String(key), String(value));
	}
}

for (const name of ["localStorage", "sessionStorage"] as const) {
	try {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value: new MemoryStorage(),
		});
	} catch {
		// 有些环境里这个属性是只读的：那就继续用环境自带的那份，下面的 afterEach 照常清空。
	}
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	sessionStorage.clear();
	document.head
		.querySelectorAll('meta[name="theme-color"], [data-injected]')
		.forEach((node) => {
			node.remove();
		});
	document.body.querySelectorAll("[data-injected]").forEach((node) => {
		node.remove();
	});
	document.documentElement.className = "";
	document.documentElement.removeAttribute("style");
	Object.defineProperty(document, "cookie", {
		configurable: true,
		value: "",
	});
	window.CustomBackgroundImage = "";
	window.CustomMobileBackgroundImage = "";
	window.ForceShowServices = false;
	window.ForceCardInline = false;
	window.ForceShowMap = false;
	window.ForcePeakCutEnabled = false;
	window.ForceSortType = undefined;
	window.ForceSortOrder = undefined;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
