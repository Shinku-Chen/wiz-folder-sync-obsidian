# WizNote Folder Sync

仓库地址：`https://github.com/Shinku-Chen/wiz-folder-sync-obsidian`

`WizNote Folder Sync` 是一个 Obsidian 的插件，用于和为知笔记 `WizNote` 进行同步，可把 Obsidian vault 中指定目录下的 Markdown 笔记、目录结构和相关资源同步到为知笔记。

当前实现支持：

- 只同步 vault 内的 `.md` 文件
- 可配置 `双向同步`、`仅 Obsidian -> 为知笔记`、`仅 为知笔记 -> Obsidian`
- 自动在目标分类下镜像子目录结构
- 支持远端 `lite/markdown`、`collaboration`、`outline` 笔记同步到 Obsidian
- 同步正文中的图片、语音和普通附件链接
- 远端资源与附件会落到本地同名 `.assets/` 目录；空附件不会保留空目录
- 删除本地笔记时，把远端笔记移入回收站
- 本地维护 `文件路径 -> docGuid` 映射，避免重复创建
- 可选的保存后自动同步
- 内置同步日志 / 调试面板，默认保留最近 1000 条日志

## 安装与发布包

- 开发构建产物位于 `.build/wiz-folder-sync-obsidian/`
- 手工安装时，把 `.build/wiz-folder-sync-obsidian/` 下的 `main.js`、`manifest.json`、`styles.css`（如存在）复制到 `<Vault>/.obsidian/plugins/wiz-folder-sync-obsidian/`
- GitHub Release 页面提供 `wiz-folder-sync-obsidian.zip` 自定义资产；压缩包内顶层目录同样为 `wiz-folder-sync-obsidian/`

## 配置项

在插件设置页中需要填写：

- `Account server URL`
  默认是 `https://note.wiz.cn`
- `WizNote account`
  为知账号，通常是邮箱
- `WizNote password`
  为了执行同步，密码会在本地加密保存
- `Source folder`
  要同步的 vault 相对目录，留空表示整个 vault
- `Target category`
  为知目标分类，例如 `/My Notes/Obsidian Sync/`；留空表示同步 `/Deleted Items/` 以外的全部目录
- `Sync mode`
  选择双向同步、仅把本地改动推送到为知笔记，或仅把为知笔记拉回 Obsidian
- `Auto sync on save`
  保存 Markdown 后自动同步变更文件
- `Auto sync debounce`
  自动同步前的防抖时间，单位毫秒

## 本地持久化

插件运行时会在插件目录中分文件保存状态：

- `account.json`
  保存账号地址、账号名和加密后的密码
- `sync.json`
  保存同步配置和本地 `文件路径 -> docGuid` 映射
- `logs.log`
  保存最近的同步日志

旧版本如果还在使用 `data.json` 或 `logs.json`，插件会在加载时自动迁移。

## 使用方式

1. 安装依赖：`npm install`
2. 构建插件：`npm run build`
3. 构建完成后，发布文件会出现在 `.build/wiz-folder-sync-obsidian/`
4. 把 `.build/wiz-folder-sync-obsidian/` 里的 `main.js`、`manifest.json`、`styles.css` 放到 vault 的 `.obsidian/plugins/wiz-folder-sync-obsidian/`
5. 在 Obsidian 中启用插件
6. 打开设置页，填入为知账号、密码、源目录和目标分类；如果目标分类留空，则同步 `/Deleted Items/` 以外的全部目录
7. 先执行 `Test WizNote connection`
8. 再执行 `Sync folder to WizNote`
9. 如果需要实时同步，打开 `Auto sync on save`
10. 如需看详细过程，可打开 `Sync log panel`

## 当前限制

- 目前使用个人知识库登录结果，不包含团队知识库切换
- 密码虽然已改为本地加密保存，但仍未接系统钥匙串
- 远端 first-class attachment 会下载到本地 `.assets/` 目录，并通过插件维护区块挂到 Markdown 底部
- 如果只修改附件文件本身、没有触发笔记保存，自动同步不会立刻触发
- 协作文档同步依赖远端 WebSocket 服务；协作文档异常时，可能出现读取或写入超时

## 构建产物

- `manifest.json` 仍然保留在仓库根目录，作为源码清单
- `npm run build` 会新建 `.build/wiz-folder-sync-obsidian/`，并把发布所需文件整理进去
- `.build/` 是发布目录，不建议提交到 Git

## 发布流程

- 更新版本时同步修改 `manifest.json` 和 `versions.json`
- Git tag 必须与 `manifest.json` 中的版本号完全一致，不加前导 `v`
- 推送 tag 后会自动触发 GitHub Actions release workflow
- Release 页面只额外上传 `wiz-folder-sync-obsidian.zip`，其余保留 GitHub 默认的 Source code 归档
- 发版描述只记录“本次发版到上一次发版之间”的变动

## 后续可扩展方向

- 使用系统钥匙串存储凭据
- 支持团队知识库切换
- 支持更细粒度的资源变更监听和增量哈希缓存
