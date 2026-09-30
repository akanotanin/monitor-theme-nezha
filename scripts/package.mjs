// 打主题包：theme.json + LICENSE + dist/（+ preview.png，可选）
// 极简探针的主题包结构：hub 只伺服静态文件，所以 dist/ 就是整站。
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";

// 默认值必须与 config.ts 同步，否则「面板显示已开启、页面还是旧形态」
execFileSync(process.execPath, ["scripts/check-defaults.mjs"], {
	stdio: "inherit",
});

const meta = JSON.parse(readFileSync("theme.json", "utf8"));
if (!/^[A-Za-z0-9_-]+$/.test(meta.short || ""))
	throw new Error(`theme.json 的 short 不合法: ${meta.short}`);
if (!existsSync("dist/index.html"))
	throw new Error("缺少 dist/index.html，先跑 pnpm build");
if (!existsSync("LICENSE")) throw new Error("缺少 LICENSE");

/**
 * 别把旧产物打进包里：源码比 dist 新就直接报错。
 * 早先 `pnpm build | tail` 掩盖了构建失败的退出码，结果装上去的是上一次的 dist。
 */
function newestMtime(dir) {
	let newest = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) newest = Math.max(newest, newestMtime(path));
		else newest = Math.max(newest, statSync(path).mtimeMs);
	}
	return newest;
}
const distMtime = statSync("dist/index.html").mtimeMs;
const srcMtime = Math.max(
	newestMtime("src"),
	statSync("index.html").mtimeMs,
	statSync("theme.json").mtimeMs,
);
if (srcMtime > distMtime) {
	throw new Error(
		"dist/ 比源码旧（构建产物过期），先跑 pnpm build 再打包；" +
			`源码 ${new Date(srcMtime).toLocaleString()} > 产物 ${new Date(distMtime).toLocaleString()}`,
	);
}

rmSync("release", { recursive: true, force: true });
const staging = "release/staging";
mkdirSync(staging, { recursive: true });
for (const file of ["theme.json", "LICENSE", "dist"])
	cpSync(file, `${staging}/${file}`, { recursive: true });
const files = ["theme.json", "LICENSE", "dist"];
if (existsSync("preview.png")) {
	cpSync("preview.png", `${staging}/preview.png`);
	files.push("preview.png");
} else {
	console.warn("提示：没有 preview.png，面板里这个主题不会有缩略图");
}

const archive = "release/theme.tar.gz";
execFileSync(
	"tar",
	["--format=ustar", "-czf", archive, "-C", staging, ...files],
	{ stdio: "inherit" },
);
const size = execFileSync("node", [
	"-e",
	`process.stdout.write(String(require('fs').statSync(${JSON.stringify(archive)}).size))`,
]).toString();
console.log(
	`Theme package: ${archive} (${(Number(size) / 1048576).toFixed(2)} MB)`,
);

const versioned = `release/monitor-theme-${meta.short}-${meta.version}.tar.gz`;
cpSync(archive, versioned);
console.log(`Versioned copy: ${versioned}`);

// 校验和：发版页和回装复验都用它比对
const { createHash } = await import("node:crypto");
const digest = createHash("sha256")
	.update(readFileSync(versioned))
	.digest("hex");
writeFileSync(
	`${versioned}.sha256`,
	`${digest}  ${versioned.split("/").pop()}\n`,
);
console.log(`sha256: ${digest}`);
