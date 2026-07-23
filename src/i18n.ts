import { getLanguage } from 'obsidian';

const translations = {
	en: {
		commandSyncFolder: 'Sync folder to wiznote',
		commandTestConnection: 'Test wiznote connection',
		commandOpenSyncLog: 'Open sync log panel',
		statusIdle: 'Wiz sync idle',
		statusStopped: 'Wiz sync stopped',
		statusTestingConnection: 'Testing Wiz connection...',
		statusConnectionOk: 'Wiz connection ok',
		statusConnectionFailed: 'Wiz connection failed',
		statusSyncingFolder: 'Syncing folder to Wiz...',
		statusSyncFailed: 'Sync failed',
		statusDeletingRemote: 'Moving wiznote to trash...',
		statusDeletingRemoteFolder: 'Moving wiznote folder to trash...',
		statusAutoSyncing: 'Auto syncing: {{path}}',
		noticeSyncRunning: 'Sync is already running.',
		noticeConnectionFailed: 'Wiz connection failed: {{message}}',
		noticeSyncFailed: 'Sync failed: {{message}}',
		noticeRemoteDeleteFailed:
			'Failed to move wiznote to trash: {{message}}',
		noticeRemoteFolderDeleteFailed:
			'Failed to move wiznote folder to trash: {{message}}',
		noticeConnectionOk:
			'Connected as {{userId}}. kbGuid={{kbGuid}}, kbServer={{kbServer}}',
		noticeSyncSummary:
			'Sync complete: {{created}} created, {{updated}} updated, {{skipped}} skipped, {{failed}} failed.',
		noticeAutoSyncSummary:
			'Auto sync: {{created}} created, {{updated}} updated, {{skipped}} skipped, {{failed}} failed.',
		progressPreparing:
			'Preparing {{local}} local files and {{remote}} remote notes...',
		progressReconcilingRemote:
			'Reconciling remote {{index}}/{{total}}: {{title}}',
		progressReconcilingLocal:
			'Reconciling local {{index}}/{{total}}: {{path}}',
		headingSync: 'Sync',
		headingDebug: 'Debug',
		settingsIntro:
			'Sync Markdown files from one vault folder into a wiznote category. Password is stored locally in the plugin data file and is not encrypted.',
		settingAccountServerName: 'Account server URL',
		settingAccountServerDesc:
			'Default is HTTPS://note.wiz.cn. Change this only for private deployments.',
		settingWizAccountName: 'Wiz account',
		settingWizAccountDesc: 'Your wiz email or user ID.',
		settingWizPasswordName: 'Wiz password',
		settingWizPasswordDesc:
			'Stored locally so the plugin can log in during sync.',
		settingSourceFolderName: 'Source folder',
		settingSourceFolderDesc:
			'Vault-relative folder to sync. Leave empty to sync the whole vault.',
		settingTargetCategoryName: 'Target category',
		settingTargetCategoryDesc:
			'Wiz category path. Use an existing root such as /my notes/Obsidian Sync/.',
		settingSyncModeName: 'Sync mode',
		settingSyncModeDesc:
			'Choose bidirectional sync, Obsidian to Wiz only, or Wiz to Obsidian only.',
		settingSyncModeBidirectional: 'Bidirectional',
		settingSyncModeLocalToRemote: 'Obsidian to Wiz only',
		settingSyncModeRemoteToLocal: 'Wiz to Obsidian only',
		settingAutoSyncName: 'Auto sync on save',
		settingAutoSyncDesc:
			'Automatically sync changed Markdown files after they are saved.',
		settingAutoSyncDebounceName: 'Auto sync debounce',
		settingAutoSyncDebounceDesc:
			'Delay in milliseconds before syncing after save.',
		settingActionsName: 'Actions',
		settingActionsDesc:
			'Test the account before syncing, or clear the local file-to-note mapping.',
		settingDebugActionsDesc:
			'Open the sync log panel or clear stored debug logs.',
		buttonTestConnection: 'Test connection',
		buttonSyncNow: 'Sync now',
		buttonClearMap: 'Clear map',
		buttonOpenSyncLog: 'Open sync log',
		buttonClearLogs: 'Clear logs',
		noticeLogsCleared: 'Sync logs cleared.',
		logViewTitle: 'Wiz sync log',
		logPanelEmpty: 'No sync logs yet.',
		logDetailLabel: 'Details',
		logLevelInfo: 'Info',
		logLevelWarn: 'Warn',
		logLevelError: 'Error',
		placeholderPassword: 'Password',
		placeholderSourceFolder: 'Inbox/to wiz',
		placeholderTargetCategory: '/my notes/Obsidian Sync/',
		errorWizAccountRequired: 'Wiz account is required.',
		errorWizPasswordRequired: 'Wiz password is required.',
		errorAccountServerInvalid: 'Account server URL is invalid.',
		errorTargetCategoryRequired: 'Target category is required.',
		errorSourceFolderMissing: 'Source folder does not exist: {{folder}}',
		errorFileOutsideSourceFolder: 'File is outside source folder: {{path}}',
		errorExpectedFileAtPath: 'Expected markdown file at path: {{path}}',
		errorRemoteNoteTypeReadonly:
			'Remote note type does not support write-back: {{type}}',
		errorCollaborationUserGuidMissing:
			'Collaboration sync needs userGuid from Wiz login result.',
		errorUntitled: 'Untitled',
	},
	zh: {
		commandSyncFolder: '同步目录到为知笔记',
		commandTestConnection: '测试为知笔记连接',
		commandOpenSyncLog: '打开同步日志面板',
		statusIdle: '为知同步空闲中',
		statusStopped: '为知同步已停止',
		statusTestingConnection: '正在测试为知连接...',
		statusConnectionOk: '为知连接正常',
		statusConnectionFailed: '为知连接失败',
		statusSyncingFolder: '正在同步目录到为知...',
		statusSyncFailed: '同步失败',
		statusDeletingRemote: '正在把为知笔记移入回收站...',
		statusDeletingRemoteFolder: '正在把为知文件夹对应笔记移入回收站...',
		statusAutoSyncing: '正在自动同步：{{path}}',
		noticeSyncRunning: '同步正在进行中。',
		noticeConnectionFailed: '为知连接失败：{{message}}',
		noticeSyncFailed: '同步失败：{{message}}',
		noticeRemoteDeleteFailed: '将为知笔记移入回收站失败：{{message}}',
		noticeRemoteFolderDeleteFailed:
			'将为知文件夹对应笔记移入回收站失败：{{message}}',
		noticeConnectionOk:
			'已连接账号 {{userId}}。kbGuid={{kbGuid}}，kbServer={{kbServer}}',
		noticeSyncSummary:
			'同步完成：新增 {{created}}，更新 {{updated}}，跳过 {{skipped}}，失败 {{failed}}。',
		noticeAutoSyncSummary:
			'自动同步完成：新增 {{created}}，更新 {{updated}}，跳过 {{skipped}}，失败 {{failed}}。',
		progressPreparing: '正在准备：本地 {{local}} 个文件，远端 {{remote}} 条笔记...',
		progressReconcilingRemote:
			'正在处理远端 {{index}}/{{total}}：{{title}}',
		progressReconcilingLocal:
			'正在处理本地 {{index}}/{{total}}：{{path}}',
		headingSync: '同步',
		headingDebug: '调试',
		settingsIntro:
			'把一个库目录中的 Markdown 笔记同步到为知笔记分类。密码会保存在插件数据文件中，且不会加密。',
		settingAccountServerName: '账号服务器地址',
		settingAccountServerDesc:
			'默认使用 HTTPS://note.wiz.cn。只有私有化部署时才需要修改。',
		settingWizAccountName: '为知账号',
		settingWizAccountDesc: '填写你的为知邮箱或用户 ID。',
		settingWizPasswordName: '为知密码',
		settingWizPasswordDesc: '密码会保存在本地，用于执行同步登录。',
		settingSourceFolderName: '源目录',
		settingSourceFolderDesc: '要同步的库内相对目录。留空表示同步整个 vault。',
		settingTargetCategoryName: '目标分类',
		settingTargetCategoryDesc:
			'为知目标分类路径，例如 /My Notes/Obsidian Sync/。',
		settingSyncModeName: '同步模式',
		settingSyncModeDesc:
			'选择双向同步、仅 Obsidian 到为知，或仅 为知 到 Obsidian。',
		settingSyncModeBidirectional: '双向同步',
		settingSyncModeLocalToRemote: '仅 Obsidian 到为知',
		settingSyncModeRemoteToLocal: '仅 为知 到 Obsidian',
		settingAutoSyncName: '保存后自动同步',
		settingAutoSyncDesc: '保存 Markdown 文件后自动同步对应变更。',
		settingAutoSyncDebounceName: '自动同步防抖',
		settingAutoSyncDebounceDesc: '保存后延迟多少毫秒再执行同步。',
		settingActionsName: '操作',
		settingActionsDesc: '先测试连接，再执行同步，或清空本地文件映射。',
		settingDebugActionsDesc: '打开同步日志面板，或清空已保存的调试日志。',
		buttonTestConnection: '测试连接',
		buttonSyncNow: '立即同步',
		buttonClearMap: '清空映射',
		buttonOpenSyncLog: '打开同步日志',
		buttonClearLogs: '清空日志',
		noticeLogsCleared: '已清空同步日志。',
		logViewTitle: '为知同步日志',
		logPanelEmpty: '暂时还没有同步日志。',
		logDetailLabel: '详细信息',
		logLevelInfo: '信息',
		logLevelWarn: '警告',
		logLevelError: '错误',
		placeholderPassword: '密码',
		placeholderSourceFolder: '收件箱/同步到为知',
		placeholderTargetCategory: '/My Notes/Obsidian Sync/',
		errorWizAccountRequired: '必须填写为知账号。',
		errorWizPasswordRequired: '必须填写为知密码。',
		errorAccountServerInvalid: '账号服务器地址无效。',
		errorTargetCategoryRequired: '必须填写目标分类。',
		errorSourceFolderMissing: '源目录不存在：{{folder}}',
		errorFileOutsideSourceFolder: '文件不在源目录内：{{path}}',
		errorExpectedFileAtPath: '路径对应的不是 Markdown 文件：{{path}}',
		errorRemoteNoteTypeReadonly: '该远端笔记类型暂不支持回写：{{type}}',
		errorCollaborationUserGuidMissing:
			'同步协作笔记需要为知登录返回的 userGuid。',
		errorUntitled: '未命名',
	},
} as const;

type TranslationKey = keyof (typeof translations)['en'];

export function t(
	key: TranslationKey,
	vars?: Record<string, string | number | undefined>,
): string {
	const locale = /^zh\b|^zh-/.test(getCurrentLanguage().toLowerCase())
		? 'zh'
		: 'en';
	const template = translations[locale][key] ?? translations.en[key];
	if (!vars) {
		return template;
	}

	return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
		const value = vars[name];
		return value === undefined ? '' : String(value);
	});
}

function getCurrentLanguage(): string {
	return getLanguage() || 'en';
}
