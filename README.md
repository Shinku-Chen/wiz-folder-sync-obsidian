# Wiz Folder Sync

仓库地址：`https://github.com/Shinku-Chen/wiz-folder-sync-obsidian`

`Wiz Folder Sync` 是一个 Obsidian 插件，用来把一个 vault 目录中的 Markdown 笔记、图片、语音和附件同步到为知笔记的某个分类。

当前实现支持：

- 只同步 vault 内的 `.md` 文件
- 可配置 `双向同步` 或 `仅 Obsidian -> 为知`
- 自动在目标分类下镜像子目录结构
- 支持远端 `lite/markdown`、`collaboration`、`outline` 笔记同步到 Obsidian
- 同步正文中的图片、语音和普通附件链接
- 远端资源与附件会落到本地同名 `.assets/` 目录
- 删除本地笔记时，把远端笔记移入回收站
- 本地维护 `文件路径 -> docGuid` 映射，避免重复创建
- 可选的保存后自动同步
- 内置同步日志 / 调试面板

## 配置项

在插件设置页中需要填写：

- `Account server URL`
  默认是 `https://note.wiz.cn`
- `Wiz account`
  为知账号，通常是邮箱
- `Wiz password`
  为了执行同步，密码会保存在插件数据里
- `Source folder`
  要同步的 vault 相对目录，留空表示整个 vault
- `Target category`
  为知目标分类，例如 `/My Notes/Obsidian Sync/`
- `Sync mode`
  选择双向同步，或只把本地改动推送到为知
- `Auto sync on save`
  保存 Markdown 后自动同步变更文件
- `Auto sync debounce`
  自动同步前的防抖时间，单位毫秒

## 使用方式

1. 安装依赖：`npm install`
2. 构建插件：`npm run build`
3. 构建完成后，发布文件会出现在 `.build/wiz-folder-sync-obsidian/`
4. 把 `.build/wiz-folder-sync-obsidian/` 里的 `main.js`、`manifest.json`、`styles.css` 放到 vault 的 `.obsidian/plugins/wiz-folder-sync-obsidian/`
5. 在 Obsidian 中启用插件
6. 打开设置页，填入为知账号、密码、源目录和目标分类
7. 先执行 `Test WizNote connection`
8. 再执行 `Sync folder to wiznote`
9. 如果需要实时同步，打开 `Auto sync on save`
10. 如需看详细过程，可打开 `Sync log panel`

## 当前限制

- 目前使用个人知识库登录结果，不包含团队知识库切换
- 密码保存在本地插件数据文件中，不是系统钥匙串
- 远端 first-class attachment 会下载到本地 `.assets/` 目录，并通过插件维护区块挂到 Markdown 底部
- 如果只修改附件文件本身、没有触发笔记保存，自动同步不会立刻触发

## 构建产物

- `manifest.json` 仍然保留在仓库根目录，作为源码清单
- `npm run build` 会新建 `.build/wiz-folder-sync-obsidian/`，并把发布所需文件整理进去
- `.build/` 是发布目录，不建议提交到 Git

## 后续可扩展方向

- 使用系统钥匙串存储凭据
- 支持团队知识库切换
- 支持更细粒度的资源变更监听和增量哈希缓存
