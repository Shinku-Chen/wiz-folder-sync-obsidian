# Changelog

项目指定变更记录文件。每次代码变动都先在这里追加一条，再进行验证、汇报和提交。

## 记录格式

### 2026-07-23

- 影响文件：`README.md`、`CHANGELOG.md`
- 摘要：调整 README 顶部产品定位文案，明确这是 Obsidian 的插件，用于和为知笔记 `WizNote` 进行同步。

- 影响文件：`README.md`、`CHANGELOG.md`
- 摘要：补充 README 顶部产品定位，明确这是为知笔记 `WizNote` 的 Obsidian 同步插件。

- 影响文件：`README.md`、`CHANGELOG.md`
- 摘要：更新 README，使其与当前 `1.0.1` 的同步模式、持久化方式、日志行为和发布产物规则保持一致。

- 影响文件：`.github/workflows/release.yml`、`CHANGELOG.md`
- 摘要：移除 GitHub Release 自动创建时的 `--draft` 参数，后续 tag 触发的 release 直接以公开发布创建。

- 影响文件：`AGENTS.md`、`CHANGELOG.md`
- 摘要：补充发布规则：发版描述只记录“本次发版到上一次发版之间”的变动，且发版时不等待 GitHub Actions 流水线完成。

- 影响文件：`manifest.json`、`versions.json`、`package.json`、`CHANGELOG.md`
- 摘要：删除已有的 `1.0.1` / `1.0.2` 标签与旧 `1.0.1` release 后，重新以当前发布流程发布 `1.0.1`。

- 影响文件：`.github/workflows/release.yml`、`AGENTS.md`、`CHANGELOG.md`
- 摘要：把 GitHub Release 自定义资产调整为只上传 `wiz-folder-sync-obsidian.zip`；其余仅保留 GitHub 默认的 Source code 归档。

- 影响文件：`.github/workflows/release.yml`、`AGENTS.md`、`CHANGELOG.md`
- 摘要：把 GitHub Release 页面收敛为只上传一个 `obsidian-wiz-folder-sync.zip`；不再单独上传 `main.js`、`manifest.json`、`styles.css`。

- 影响文件：`manifest.json`、`versions.json`、`package.json`、`CHANGELOG.md`
- 摘要：发布 `1.0.2` 版本，并同步更新插件清单、版本映射和 npm 包版本号。

- 影响文件：`manifest.json`、`versions.json`、`package.json`、`CHANGELOG.md`
- 摘要：发布 `1.0.1` 版本，并同步更新插件清单、版本映射、npm 包版本号，以及 `manifest.json` 中指向仓库的作者/赞助链接。

- 影响文件：`src/settings.ts`、`CHANGELOG.md`
- 摘要：把调试日志保留上限从 100 条提高到 1000 条，扩大日志面板和 `logs.log` 的可追溯窗口。

- 影响文件：`src/sync/assets.ts`、`CHANGELOG.md`
- 摘要：远端附件或资源下载结果为空时改为跳过落盘；若当前同步最终没有任何可写附件，还会删除已存在的空 `.assets` 目录，减少 Obsidian 中残留的空文件夹。

- 影响文件：`AGENTS.md`、`src/persistence.ts`、`CHANGELOG.md`
- 摘要：把日志持久化文件从 `logs.json` 改为纯文本 `logs.log`，按原始日志条目写盘，并兼容迁移已存在的 `logs.json`。

- 影响文件：`AGENTS.md`、`src/main.ts`、`src/settings.ts`、`src/persistence.ts`、`src/i18n.ts`、`CHANGELOG.md`
- 摘要：把插件持久化拆分为账号、同步、日志三个独立文件；密码改为本地加密存储，并在升级时自动迁移旧 `data.json`。

- 影响文件：`src/sync/service.ts`、`CHANGELOG.md`
- 摘要：把冲突笔记的本地命名改为 `标题[短 docGuid].md`；短后缀插入到 `.md` 前面，避免失去 markdown 扩展名并连带消除资源目录冲突。

- 影响文件：`src/sync/service.ts`、`CHANGELOG.md`
- 摘要：把冲突笔记的本地后缀格式调整为 `标题.md[短 docGuid]`，便于和原始标题一起识别。

- 影响文件：`src/sync/service.ts`、`CHANGELOG.md`
- 摘要：改为保留同目录同标题的多条远端笔记；当本地路径冲突时自动追加稳定后缀，而不是直接按路径去重丢弃笔记。

- 影响文件：`src/sync/service.ts`、`CHANGELOG.md`
- 摘要：远端拉取前按目标本地路径去重；同一路径存在多条远端笔记时优先保留已记录的 `docGuid`，否则保留较新的远端笔记，避免同一路径在一次同步中被反复覆盖。

- 影响文件：`src/path.ts`、`src/sync/assets.ts`、`src/sync/service.ts`、`src/wiz/client.ts`、`CHANGELOG.md`
- 摘要：为远端标题和资源文件名增加本地安全化处理，并修正协作资源下载鉴权，避免 `:` 非法路径和协作资源 `403` 导致拉取失败。

- 影响文件：`src/wiz/client.ts`、`src/sync/service.ts`、`CHANGELOG.md`
- 摘要：把远端资源/附件下载改为 `requestUrl`，并修正“仅 为知笔记 到 Obsidian”模式下远端对账误回写远端的问题。

- 影响文件：`src/sync/assets.ts`、`src/sync/service.ts`、`CHANGELOG.md`
- 摘要：补充远端资源同步诊断日志，区分正文读取、资源列表和单个资源/附件下载失败。

- 影响文件：`src/sync/service.ts`、`CHANGELOG.md`
- 摘要：修正基于修改时间的单文件同步跳过判断，减少自动同步中的不必要更新。

- 影响文件：`manifest.json`、`README.md`、`src/i18n.ts`、`src/main.ts`、`src/sync/assets.ts`、`AGENTS.md`、`CHANGELOG.md`
- 摘要：统一记录并使用产品名对应关系：中文写“为知笔记”，英文写 `WizNote`。

- 影响文件：`src/sync/service.ts`、`src/main.ts`、`src/wiz/client.ts`、`src/i18n.ts`、`src/ui/settings-tab.ts`、`README.md`、`AGENTS.md`、`CHANGELOG.md`
- 摘要：允许目标分类留空；留空时同步为知笔记中 `/Deleted Items/` 以外的全部目录。

- 影响文件：`src/i18n.ts`、`CHANGELOG.md`
- 摘要：把同步模式下拉框中的“为知”文案改为“为知笔记”。

- 影响文件：`AGENTS.md`、`CHANGELOG.md`
- 摘要：指定根目录 `CHANGELOG.md` 为项目变更记录文档，并要求每次代码变动先更新该文件。
