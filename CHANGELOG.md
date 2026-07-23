# Changelog

项目指定变更记录文件。每次代码变动都先在这里追加一条，再进行验证、汇报和提交。

## 记录格式

### 2026-07-23

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
