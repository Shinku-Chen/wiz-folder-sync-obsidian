# AGENTS.md

给 AI agent（Claude Code / Codex / Cursor 等）读的仓库说明。

## 项目概述

- Target: Obsidian Community Plugin（TypeScript -> bundled JavaScript）。
- 插件 ID：`wiz-folder-sync-obsidian`。
- Entry point：`src/main.ts`，编译后产出 `main.js`，由 Obsidian 加载。
- 作用：把 Obsidian vault 中指定目录下的 Markdown 笔记、目录结构和相关资源同步到为知笔记目标分类，并在本地维护 `文件路径 -> docGuid` 映射，避免重复创建远端笔记。
- Required release artifacts：`main.js`、`manifest.json`、可选 `styles.css`。

## 环境与工具

- Node.js：使用当前 LTS，推荐 Node 18+。
- Package manager：`npm`。
- Bundler：`esbuild`，构建依赖 `esbuild.config.mjs`。
- Types：`obsidian` 类型定义。

说明：这是一个有明确 npm + esbuild 技术依赖的 Obsidian 插件项目。若未来替换 bundler，需要同时替换构建配置，并保证所有运行时依赖都被打包进 `main.js`。

## 目录结构

```text
src/main.ts               插件生命周期入口；保持精简，只放 onload/onunload、状态恢复、事件注册和命令调度
src/commands.ts           Obsidian 命令注册
src/i18n.ts               中英文 UI 文案与翻译函数
src/settings.ts           插件设置、持久化数据结构与默认值
src/sync/service.ts       同步主流程、本地/远端对账、自动同步入口
src/ui/settings-tab.ts    设置页 UI
src/wiz/client.ts         为知 API 登录、分类和笔记读写
src/wiz/markdown.ts       Markdown 与为知 HTML 包装/解包
scripts/prepare-build.mjs 构建后整理发布产物到 .build/<plugin-id>/
manifest.json             Obsidian 插件清单
styles.css                插件样式
README.md                 面向用户的使用说明
CHANGELOG.md              项目指定变更记录；每次代码变动都要先追加本次改动摘要
versions.json             插件版本到最低 Obsidian 版本的映射
```

- Source lives in `src/`。把功能按模块拆开，不要把逻辑重新堆回 `main.ts`。
- 如果新增目录，优先按 `commands/`、`ui/`、`utils/`、`types.ts` 这类清晰边界组织。
- 根目录不要提交 `node_modules/`、`.build/`、`build/`、`main.js` 等构建产物。
- 发布产物应位于 `.build/wiz-folder-sync-obsidian/`，而不是直接提交到仓库根目录。

## 构建与验证

```bash
npm install
npm run dev
npm run build
npm run lint
```

- `npm run build` 会执行 TypeScript 检查、esbuild 打包，并由 `scripts/prepare-build.mjs` 把发布文件整理到 `.build/wiz-folder-sync-obsidian/`。
- 当前仓库没有独立的自动化测试脚本。改动后至少跑 `npm run build` 和 `npm run lint`。
- 如果改动影响同步流程、设置页、事件监听或发布产物整理，额外做一次手工验证：
  把 `.build/wiz-folder-sync-obsidian/` 下的 `main.js`、`manifest.json`、`styles.css` 放入 `<Vault>/.obsidian/plugins/wiz-folder-sync-obsidian/`，然后在 Obsidian 的 **Settings → Community plugins** 中启用并验证。

## Manifest 规则

- `manifest.json` 必须至少包含：`id`、`name`、`version`、`minAppVersion`、`description`、`isDesktopOnly`。
- 当前 `id` 是 `wiz-folder-sync-obsidian`。发布后不要修改，视为稳定 API。
- 使用较新的 Obsidian API 时，同步确认并更新 `minAppVersion`。
- 当前 `isDesktopOnly` 为 `false`。除非明确调整产品边界，否则不要引入只能在桌面端工作的 Node/Electron 依赖或行为假设。

## Commands 与设置

- 所有用户可见命令通过 `this.addCommand(...)` 注册。
- 使用稳定 command ID，不要随意改名。
- 插件配置通过设置页暴露，并提供合理默认值和必要校验。
- 持久化使用 `this.loadData()` / `this.saveData()`。
- 新增用户可见文案时，优先收敛到 `src/i18n.ts`，不要把中英文字符串散落在多个文件里。

## 代码约定

- 使用 TypeScript，优先保持严格类型和清晰边界。
- 保持 `src/main.ts` 精简，只负责插件生命周期、状态恢复、事件注册和命令调用；具体业务逻辑放到 `src/sync/`、`src/wiz/`、`src/ui/` 等模块。
- 继续沿用 `async/await` 风格，不要回退到长 promise chain。
- 文件超过约 200 到 300 行时，优先考虑拆分。
- 同步逻辑需要支持 `双向同步` 与 `仅 Obsidian -> WizNote` 两种模式，默认保持双向；不要无意改回单向默认，或引入跨 vault 路径访问。
- `targetCategory` 允许留空；留空时表示同步为知笔记中 `/Deleted Items/` 以外的全部目录。
- 产品名文案统一：中文写“为知笔记”，英文写 `WizNote`；不要在用户可见文案里混用 `Wiz` 或 `wiznote`。
- 保持启动阶段轻量。避免在 `onload` 做重型工作，必要时延迟初始化。
- 批量处理磁盘和远端数据，避免高频全量扫描；对文件事件相关的昂贵操作做 debounce/throttle。
- 注释与文档默认使用中文；技术术语、类型名、API 名和协议字段保留英文。

## 安全、隐私与边界

- 默认偏向本地 / 离线；网络请求只用于用户显式触发的为知连接测试与同步。
- 不要加入隐藏遥测、后台上传或与功能无关的第三方请求。
- 不要执行远端代码、拉取并执行脚本，或绕过正常发布流程自动更新插件代码。
- 只处理 vault 内 Markdown 文件，不读取 vault 外文件，不上传与同步目标无关的数据。
- 不把用户的 vault 内容、文件名或个人信息用于遥测或其它未声明用途。
- 当前为知账号密码保存在插件数据文件中，未接系统钥匙串；涉及这部分改动时，优先提高透明度和可控性，不要弱化风险提示。
- 若未来引入任何外部服务、分析能力或额外数据传输，必须显式告知，并要求用户可理解的选择权。

## UX 与文案

- UI 文案使用简洁、动作导向的句子。
- 标题、按钮、设置项遵循 sentence case。
- 导航描述使用 **Settings → Community plugins** 这种箭头写法。
- 不要使用含糊、营销化或术语堆砌的提示文案。

## Mobile

- 当前 manifest 允许移动端，因此不要默认假设桌面环境。
- 改动涉及文件系统行为、内存占用或 UI 交互时，考虑 iOS / Android 的兼容性。
- 避免构建只适用于桌面的行为，除非明确把 `isDesktopOnly` 改为 `true` 并更新文档。

## Agent Do / Don't

Do:

- 添加稳定的命令 ID。
- 给设置项提供默认值和基本校验。
- 保持代码路径幂等，确保 reload / unload 不泄漏监听器、定时器或状态。
- 使用 `this.registerEvent`、`this.registerDomEvent`、`this.registerInterval` 等清理机制。

Don't:

- 引入没有明显用户价值的网络请求。
- 在未清楚披露风险和用途的情况下引入云服务依赖。
- 在没有用户明确同意的前提下存储或传输 vault 内容。

## 提交规范

- 每次修改代码时，必须先把改动实际写回项目文件，再进行验证、汇报和提交；不要只停留在方案说明或伪代码层。
- 每次代码变动都要先更新根目录 `CHANGELOG.md`，记录日期、影响文件和改动摘要；未更新变更记录时，不进入验证、汇报和提交流程。
- commit 标题：`type(scope): 简述`，`type` 取 `feat/fix/docs/refactor/perf/test/chore/build/ci`，简述用祈使句、默认中文、结尾不加句号。
- 一个 commit 只做一件事，message 描述最终 diff，不记录调试过程。
- commit 后在同一轮内 `git push`；如果仓库采用分支或 PR 流程，按协作流程走，不要把无关改动混进去。
- push 前检查仓库根是否同时存在 `AGENTS.md` 和 `CLAUDE.md`，缺失时先补齐。
- 项目 memory 要写入项目规范。凡是 memory 记录了本项目的决策、约定、踩坑、架构边界、运行方式、测试方式、发布流程或团队口径，同步写回本文件或项目内对应规范文件。

## 版本与发布

- 更新版本时同步修改 `manifest.json` 和 `versions.json`，版本号使用语义化版本。
- GitHub release tag 必须与 `manifest.json` 中的版本号完全一致，不加前导 `v`。
- release 资产应包含 `manifest.json`、`main.js`、`styles.css`（如存在）。
- 构建后的发布目录是 `.build/wiz-folder-sync-obsidian/`；验证发布包时以该目录内容为准。

## 常见任务

### 新增命令

```ts
this.addCommand({
	id: 'your-command-id',
	name: 'Do the thing',
	callback: () => this.doTheThing(),
});
```

### 持久化设置

```ts
interface MySettings {
	enabled: boolean;
}

const DEFAULT_SETTINGS: MySettings = {
	enabled: true,
};

async onload() {
	this.settings = Object.assign(
		{},
		DEFAULT_SETTINGS,
		(await this.loadData()) as Partial<MySettings>,
	);
	await this.saveData(this.settings);
}
```

### 安全注册监听器

```ts
this.registerEvent(
	this.app.workspace.on('file-open', (f) => {
		/* ... */
	}),
);

this.registerDomEvent(window, 'resize', () => {
	/* ... */
});

this.registerInterval(
	window.setInterval(() => {
		/* ... */
	}, 1000),
);
```

## Troubleshooting

- 插件未加载：确认 `main.js` 和 `manifest.json` 位于 `<Vault>/.obsidian/plugins/wiz-folder-sync-obsidian/` 顶层。
- 构建后找不到发布文件：先运行 `npm run build`，再检查 `.build/wiz-folder-sync-obsidian/`。
- 命令未出现：确认 `addCommand` 在 `onload` 中执行，且 command ID 唯一。
- 设置未持久化：确认 `loadData` / `saveData` 已正确 `await`，且设置变更后 UI 与状态同步更新。
- 移动端异常：确认没有依赖桌面专属 API，并重新核对 `manifest.json` 的 `isDesktopOnly`。

## 参考

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
