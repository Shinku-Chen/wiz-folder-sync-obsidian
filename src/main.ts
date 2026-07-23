import {
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from 'obsidian';
import { registerCommands } from './commands';
import { formatLogDetail } from './logging';
import { t } from './i18n';
import {
	loadPluginStorage,
	savePluginStorage,
	type StorageWarning,
} from './persistence';
import {
	DEFAULT_SETTINGS,
	MAX_DEBUG_LOGS,
	type DebugLogEntry,
	type DebugLogLevel,
	type PluginState,
} from './settings';
import {
	activateSyncLogView,
	SYNC_LOG_VIEW_TYPE,
	WizSyncLogView,
} from './ui/log-view';
import { WizFolderSyncSettingTab } from './ui/settings-tab';
import {
	listNestedCategories,
	normalizeCategoryPath,
	testWizConnection,
	WizClient,
} from './wiz/client';
import {
	isPathInSyncScope,
	syncFileToWiz,
	syncFolderToWiz,
} from './sync/service';

export default class WizFolderSyncPlugin extends Plugin {
	settings = { ...DEFAULT_SETTINGS };
	state: PluginState = { records: {}, logs: [] };
	private statusBarItemEl: HTMLElement | null = null;
	private syncInFlight: Promise<void> | null = null;
	private autoSyncTimer: number | null = null;
	private pendingAutoSyncPaths = new Set<string>();

	async onload() {
		const storageWarnings = await this.loadPluginState();

		this.statusBarItemEl = this.addStatusBarItem();
		this.setStatus(t('statusIdle'));
		this.registerView(
			SYNC_LOG_VIEW_TYPE,
			(leaf) => new WizSyncLogView(leaf, this),
		);

		registerCommands(this);
		this.addSettingTab(new WizFolderSyncSettingTab(this.app, this));
		this.reportStorageWarnings(storageWarnings);

		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				await this.handleRename(file, oldPath);
			}),
		);

		this.registerEvent(
			this.app.vault.on('delete', async (file) => {
				if (file instanceof TFolder) {
					if (!this.allowsLocalToRemoteSync()) {
						return;
					}
					await this.handleRemoteFolderDelete(file.path);
					return;
				}

				if (!(file instanceof TFile) || file.extension !== 'md') {
					return;
				}

				if (!this.allowsLocalToRemoteSync()) {
					return;
				}

				const record = this.state.records[file.path];
				if (!record) {
					return;
				}

				await this.handleRemoteDelete(file.path, record.docGuid);
			}),
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				this.handleFileModify(file);
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void this.runLifecycleSync('startup');
		});
	}

	onunload() {
		this.clearAutoSyncTimer();
		this.setStatus(t('statusStopped'));
	}

	getDebugLogs(): DebugLogEntry[] {
		return this.state.logs;
	}

	async runSyncCommand() {
		await this.runManagedSync({
			scope: 'sync',
			startMessage: 'Manual sync started',
			notifyIfRunning: true,
			successNotice: true,
			failureNotice: true,
		});
	}

	async testConnectionCommand() {
		try {
			this.setStatus(t('statusTestingConnection'));
			this.appendLog(
				'info',
				'connection',
				'Testing WizNote connection',
				formatLogDetail([
					['accountBaseUrl', this.settings.accountBaseUrl],
					['userId', this.settings.userId],
					['targetCategory', this.settings.targetCategory],
					['syncMode', this.settings.syncMode],
				]),
			);
			const summary = await testWizConnection(this.settings);
			new Notice(summary, 8000);
			this.setStatus(t('statusConnectionOk'));
			this.appendLog(
				'info',
				'connection',
				summary,
				formatLogDetail([
					['accountBaseUrl', this.settings.accountBaseUrl],
					['userId', this.settings.userId],
				]),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(t('statusConnectionFailed'));
			new Notice(t('noticeConnectionFailed', { message }), 10000);
			this.appendLog(
				'error',
				'connection',
				'WizNote connection failed',
				formatLogDetail([
					['accountBaseUrl', this.settings.accountBaseUrl],
					['userId', this.settings.userId],
					['targetCategory', this.settings.targetCategory],
					['syncMode', this.settings.syncMode],
					['error', message],
				]),
			);
			throw error;
		}
	}

	async savePluginState() {
		await savePluginStorage(this, {
			settings: this.settings,
			state: this.state,
		});
	}

	async clearSyncState() {
		this.state = { records: {}, logs: this.state.logs };
		this.appendLog('info', 'state', 'Sync mapping cleared');
		await this.savePluginState();
	}

	async clearDebugLogs() {
		this.state.logs = [];
		await this.savePluginState();
		this.refreshSyncLogView();
		new Notice(t('noticeLogsCleared'));
	}

	async openSyncLogView() {
		await activateSyncLogView(this);
	}

	setStatus(text: string) {
		this.statusBarItemEl?.setText(text);
	}

	private async loadPluginState(): Promise<StorageWarning[]> {
		const persisted = await loadPluginStorage(this);
		this.settings = persisted.data.settings;
		this.state = persisted.data.state;
		return persisted.warnings;
	}

	private async performSync(options?: {
		successNotice?: boolean;
		failureNotice?: boolean;
	}) {
		const successNotice = options?.successNotice ?? true;
		const failureNotice = options?.failureNotice ?? true;
		try {
			this.setStatus(t('statusSyncingFolder'));
			this.appendLog(
				'info',
				'sync',
				'Running folder sync',
				formatLogDetail([
					['syncMode', this.settings.syncMode],
					['sourceFolder', this.settings.sourceFolder || '(vault root)'],
					['targetCategory', this.settings.targetCategory],
					['autoSyncOnSave', this.settings.autoSyncOnSave],
					['pendingAutoSyncCount', this.pendingAutoSyncPaths.size],
				]),
			);
			const result = await syncFolderToWiz({
				app: this.app,
				settings: this.settings,
				state: this.state,
				onProgress: (message) => this.setStatus(message),
				onLog: (entry) =>
					this.appendLog(
						entry.level ?? 'info',
						entry.scope ?? 'sync',
						entry.message,
						entry.detail,
					),
				saveState: async () => {
					await this.savePluginState();
				},
			});

			const summary = t('noticeSyncSummary', {
				created: result.created,
				updated: result.updated,
				skipped: result.skipped,
				failed: result.failed,
			});
			this.setStatus(summary);
			if (successNotice) {
				new Notice(summary, 10000);
			}
			this.appendLog(
				'info',
				'sync',
				summary,
				formatLogDetail([
					['syncMode', this.settings.syncMode],
					['sourceFolder', this.settings.sourceFolder || '(vault root)'],
					['targetCategory', this.settings.targetCategory],
					['scanned', result.scanned],
					['created', result.created],
					['updated', result.updated],
					['skipped', result.skipped],
					['failed', result.failed],
				]),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(t('statusSyncFailed'));
			if (failureNotice) {
				new Notice(t('noticeSyncFailed', { message }), 12000);
			}
			this.appendLog(
				'error',
				'sync',
				'Folder sync failed',
				formatLogDetail([
					['syncMode', this.settings.syncMode],
					['sourceFolder', this.settings.sourceFolder || '(vault root)'],
					['targetCategory', this.settings.targetCategory],
					['error', message],
				]),
			);
			throw error;
		}
	}

	private async runManagedSync(options: {
		scope: string;
		startMessage: string;
		notifyIfRunning: boolean;
		successNotice: boolean;
		failureNotice: boolean;
	}) {
		if (this.syncInFlight) {
			this.appendLog(
				'info',
				options.scope,
				`${options.startMessage} skipped because another sync is already running`,
			);
			if (options.notifyIfRunning) {
				new Notice(t('noticeSyncRunning'));
			}
			return this.syncInFlight;
		}

		this.appendLog('info', options.scope, options.startMessage);
		const syncTask = this.performSync({
			successNotice: options.successNotice,
			failureNotice: options.failureNotice,
		});
		this.syncInFlight = syncTask;

		try {
			await syncTask;
		} finally {
			if (this.syncInFlight === syncTask) {
				this.syncInFlight = null;
			}
		}
	}

	private async runLifecycleSync(trigger: 'startup') {
		if (!this.isSyncConfigured()) {
			this.appendLog(
				'info',
				trigger,
				`Skipped ${trigger} sync because WizNote sync is not fully configured`,
				formatLogDetail([
					['accountBaseUrl', this.settings.accountBaseUrl],
					['userId', this.settings.userId],
					['targetCategory', this.settings.targetCategory],
					['syncMode', this.settings.syncMode],
				]),
			);
			return;
		}

		await this.runManagedSync({
			scope: trigger,
			startMessage: 'Startup sync started',
			notifyIfRunning: false,
			successNotice: false,
			failureNotice: true,
		});
	}

	private isSyncConfigured(): boolean {
		return (
			this.settings.accountBaseUrl.trim().length > 0 &&
			this.settings.userId.trim().length > 0 &&
			this.settings.password.length > 0
		);
	}

	private allowsLocalToRemoteSync(): boolean {
		return this.settings.syncMode !== 'remote-to-local';
	}

	private handleFileModify(file: TAbstractFile) {
		if (!(file instanceof TFile) || file.extension !== 'md') {
			return;
		}

		if (!this.allowsLocalToRemoteSync()) {
			return;
		}

		if (!this.settings.autoSyncOnSave) {
			return;
		}

		const sourceFolder = this.settings.sourceFolder
			.trim()
			.replace(/^\/+/, '')
			.replace(/\/+$/, '');
		if (
			!isPathInSyncScope(
				file.path,
				sourceFolder,
				this.settings.targetCategory,
			)
		) {
			return;
		}

		this.pendingAutoSyncPaths.add(file.path);
		this.appendLog(
			'info',
			'watch',
			`Queued auto sync for ${file.path}`,
			formatLogDetail([
				['path', file.path],
				['mtime', file.stat.mtime],
				['debounceMs', this.getAutoSyncDebounceMs()],
				['queuedCount', this.pendingAutoSyncPaths.size],
			]),
		);
		this.scheduleAutoSync();
	}

	private async handleRename(file: TAbstractFile, oldPath: string) {
		if (file instanceof TFolder) {
			await this.handleFolderRename(file, oldPath);
			return;
		}

		if (!(file instanceof TFile) || file.extension !== 'md') {
			return;
		}

		const record = this.state.records[oldPath];
		if (!record) {
			return;
		}

		delete this.state.records[oldPath];
		this.state.records[file.path] = {
			...record,
			fileMtime: 0,
		};
		this.appendLog(
			'info',
			'vault',
			`Renamed note ${oldPath} -> ${file.path}`,
			formatLogDetail([
				['oldPath', oldPath],
				['newPath', file.path],
				['docGuid', record.docGuid],
				['remoteCategory', record.remoteCategory],
				['remoteTitle', record.remoteTitle],
			]),
		);
		await this.savePluginState();
	}

	private async handleFolderRename(folder: TFolder, oldPath: string) {
		const oldPrefix = `${oldPath}/`;
		const newPrefix = `${folder.path}/`;
		let changed = false;

		for (const path of Object.keys(this.state.records)) {
			if (!path.startsWith(oldPrefix)) {
				continue;
			}

			const record = this.state.records[path];
			if (!record) {
				continue;
			}

			const nextPath = `${newPrefix}${path.slice(oldPrefix.length)}`;
			this.state.records[nextPath] = {
				...record,
				fileMtime: 0,
			};
			delete this.state.records[path];
			changed = true;
		}

		if (changed) {
			this.appendLog(
				'info',
				'vault',
				`Renamed folder ${oldPath} -> ${folder.path}`,
				formatLogDetail([
					['oldPath', oldPath],
					['newPath', folder.path],
				]),
			);
			await this.savePluginState();
		}
	}

	private async handleRemoteDelete(path: string, docGuid: string) {
		try {
			this.setStatus(t('statusDeletingRemote'));
			const client = await WizClient.login(this.settings);
			await client.deleteNote(docGuid);
			delete this.state.records[path];
			await this.savePluginState();
			this.setStatus(t('statusIdle'));
			this.appendLog(
				'info',
				'delete',
				`Moved remote note to trash for ${path}`,
				formatLogDetail([
					['path', path],
					['docGuid', docGuid],
				]),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('noticeRemoteDeleteFailed', { message }), 10000);
			this.appendLog(
				'error',
				'delete',
				`Failed to trash remote note for ${path}`,
				formatLogDetail([
					['path', path],
					['docGuid', docGuid],
					['error', message],
				]),
			);
			throw error;
		}
	}

	private async handleRemoteFolderDelete(folderPath: string) {
		const sourceFolder = this.normalizeSourceFolder();
		if (
			!isPathInSyncScope(
				folderPath,
				sourceFolder,
				this.settings.targetCategory,
			)
		) {
			return;
		}

		try {
			this.setStatus(t('statusDeletingRemoteFolder'));
			const client = await WizClient.login(this.settings);
			const categories = await client.getCategories();
			const remoteRootCategory = this.buildRemoteCategoryForFolder(
				folderPath,
				sourceFolder,
			);
			const remoteCategories = listNestedCategories(
				categories,
				remoteRootCategory,
			);
			const docGuids = new Set<string>();

			for (const category of remoteCategories) {
				const notes = await client.listCategoryNotes(category);
				for (const note of notes) {
					docGuids.add(note.docGuid);
				}
			}

			for (const docGuid of docGuids) {
				await client.deleteNote(docGuid);
			}

			const categoriesToDelete = [...remoteCategories].sort(
				(left, right) => right.length - left.length,
			);
			for (const category of categoriesToDelete) {
				await client.deleteCategory(category);
			}

			this.deleteStateRecordsUnderFolder(folderPath);
			this.clearPendingAutoSyncForFolder(folderPath);
			await this.savePluginState();
			this.setStatus(t('statusIdle'));
			this.appendLog(
				'info',
				'delete',
				`Moved remote folder subtree to trash for ${folderPath}`,
				formatLogDetail([
					['folderPath', folderPath],
					['remoteRootCategory', remoteRootCategory],
					['remoteCategoryCount', remoteCategories.length],
					['remoteNoteCount', docGuids.size],
				]),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('noticeRemoteFolderDeleteFailed', { message }), 10000);
			this.appendLog(
				'error',
				'delete',
				`Failed to trash remote folder subtree for ${folderPath}`,
				formatLogDetail([
					['folderPath', folderPath],
					['error', message],
				]),
			);
			throw error;
		}
	}

	private deleteStateRecordsUnderFolder(folderPath: string) {
		const prefix = `${folderPath}/`;
		for (const path of Object.keys(this.state.records)) {
			if (path.startsWith(prefix)) {
				delete this.state.records[path];
			}
		}
	}

	private clearPendingAutoSyncForFolder(folderPath: string) {
		const prefix = `${folderPath}/`;
		for (const path of [...this.pendingAutoSyncPaths]) {
			if (path.startsWith(prefix)) {
				this.pendingAutoSyncPaths.delete(path);
			}
		}
	}

	private normalizeSourceFolder(): string {
		return this.settings.sourceFolder
			.trim()
			.replace(/^\/+/, '')
			.replace(/\/+$/, '');
	}

	private buildRemoteCategoryForFolder(
		folderPath: string,
		sourceFolder: string,
	): string {
		const targetCategory = normalizeCategoryPath(this.settings.targetCategory, {
			allowRoot: true,
		});
		if (!sourceFolder || folderPath !== sourceFolder) {
			const relativePath = sourceFolder
				? folderPath.slice(sourceFolder.length + 1)
				: folderPath;
			if (relativePath) {
				return normalizeCategoryPath(`${targetCategory}${relativePath}`, {
					allowRoot: true,
				});
			}
		}

		return targetCategory;
	}

	private scheduleAutoSync() {
		this.clearAutoSyncTimer();
		this.autoSyncTimer = window.setTimeout(() => {
			void this.flushAutoSyncQueue();
		}, this.getAutoSyncDebounceMs());
	}

	private clearAutoSyncTimer() {
		if (this.autoSyncTimer !== null) {
			window.clearTimeout(this.autoSyncTimer);
			this.autoSyncTimer = null;
		}
	}

	private getAutoSyncDebounceMs(): number {
		const value = this.settings.autoSyncDebounceMs;
		if (!Number.isFinite(value)) {
			return DEFAULT_SETTINGS.autoSyncDebounceMs;
		}

		return Math.max(300, Math.min(30000, Math.round(value)));
	}

	private async flushAutoSyncQueue() {
		this.autoSyncTimer = null;
		if (this.pendingAutoSyncPaths.size === 0) {
			return;
		}

		if (this.syncInFlight) {
			this.scheduleAutoSync();
			return;
		}

		const paths = [...this.pendingAutoSyncPaths];
		this.pendingAutoSyncPaths.clear();

		this.syncInFlight = this.performAutoSync(paths);
		try {
			await this.syncInFlight;
		} finally {
			this.syncInFlight = null;
			if (this.pendingAutoSyncPaths.size > 0) {
				this.scheduleAutoSync();
			}
		}
	}

	private async performAutoSync(paths: string[]) {
		let created = 0;
		let updated = 0;
		let skipped = 0;
		let failed = 0;

		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || file.extension !== 'md') {
				continue;
			}

			try {
				this.setStatus(t('statusAutoSyncing', { path: file.path }));
				this.appendLog(
					'info',
					'autosync',
					`Auto syncing ${file.path}`,
					formatLogDetail([
						['path', file.path],
						['mtime', file.stat.mtime],
						['syncMode', this.settings.syncMode],
					]),
				);
				const outcome = await syncFileToWiz({
					app: this.app,
					settings: this.settings,
					state: this.state,
					file,
					onLog: (entry) =>
						this.appendLog(
							entry.level ?? 'info',
							entry.scope ?? 'autosync',
							entry.message,
							entry.detail,
						),
					saveState: async () => {
						await this.savePluginState();
					},
				});

				if (outcome === 'created') {
					created += 1;
				} else if (outcome === 'updated') {
					updated += 1;
				} else {
					skipped += 1;
				}
				this.appendLog(
					'info',
					'autosync',
					`Auto sync ${outcome} for ${file.path}`,
					formatLogDetail([
						['path', file.path],
						['outcome', outcome],
						['mtime', file.stat.mtime],
					]),
				);
			} catch (error) {
				failed += 1;
				console.error(`[wiz-folder-sync] Auto sync failed for ${path}`, error);
				this.appendLog(
					'error',
					'autosync',
					`Auto sync failed for ${path}`,
					formatLogDetail([
						['path', path],
						['error', error instanceof Error ? error.message : String(error)],
					]),
				);
			}
		}

		const summary = t('noticeAutoSyncSummary', {
			created,
			updated,
			skipped,
			failed,
		});
		this.setStatus(summary);
		this.appendLog(
			'info',
			'autosync',
			summary,
			formatLogDetail([
				['created', created],
				['updated', updated],
				['skipped', skipped],
				['failed', failed],
				['fileCount', paths.length],
			]),
		);
		if (failed > 0) {
			new Notice(summary, 10000);
		}
	}

	appendLog(
		level: DebugLogLevel,
		scope: string,
		message: string,
		detail?: string,
	) {
		const entry: DebugLogEntry = {
			id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
			at: new Date().toISOString(),
			level,
			scope,
			message,
			detail,
		};
		this.state.logs = [...this.state.logs, entry].slice(-MAX_DEBUG_LOGS);
		this.refreshSyncLogView();
	}

	private reportStorageWarnings(warnings: StorageWarning[]) {
		for (const warning of warnings) {
			const message = this.getStorageWarningMessage(warning);
			const detail =
				warning.detail || warning.fileName
					? formatLogDetail([
							['fileName', warning.fileName],
							['detail', warning.detail],
						])
					: undefined;
			this.appendLog(warning.level, 'storage', message, detail);
			if (warning.code === 'legacy-migrated' || warning.code === 'password-unavailable') {
				new Notice(message, 10000);
			}
		}
	}

	private getStorageWarningMessage(warning: StorageWarning): string {
		switch (warning.code) {
			case 'legacy-migrated':
				return t('noticeStorageMigrated');
			case 'password-unavailable':
				return t('noticePasswordUnavailable');
			case 'storage-file-invalid':
				return t('logStorageFileInvalid', {
					fileName: warning.fileName ?? 'unknown',
				});
			default:
				return warning.code;
		}
	}

	private refreshSyncLogView() {
		this.app.workspace
			.getLeavesOfType(SYNC_LOG_VIEW_TYPE)
			.forEach((leaf) => {
				const view = leaf.view;
				if (view instanceof WizSyncLogView) {
					view.refresh();
				}
			});
	}
}
