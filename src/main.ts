import {
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from 'obsidian';
import { registerCommands } from './commands';
import { t } from './i18n';
import {
	DEFAULT_SETTINGS,
	loadPersistedData,
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
	isFileInSourceFolder,
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
		await this.loadPluginState();

		this.statusBarItemEl = this.addStatusBarItem();
		this.setStatus(t('statusIdle'));
		this.registerView(
			SYNC_LOG_VIEW_TYPE,
			(leaf) => new WizSyncLogView(leaf, this),
		);

		registerCommands(this);
		this.addSettingTab(new WizFolderSyncSettingTab(this.app, this));

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

		this.registerEvent(
			this.app.workspace.on('quit', (tasks) => {
				// Obsidian only offers a best-effort quit hook. Queue a final sync task here.
				tasks.add(async () => {
					await this.runLifecycleSync('shutdown');
				});
			}),
		);
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
			this.appendLog('info', 'connection', 'Testing Wiz connection');
			const summary = await testWizConnection(this.settings);
			new Notice(summary, 8000);
			this.setStatus(t('statusConnectionOk'));
			this.appendLog('info', 'connection', summary);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(t('statusConnectionFailed'));
			new Notice(t('noticeConnectionFailed', { message }), 10000);
			this.appendLog('error', 'connection', 'Wiz connection failed', message);
			throw error;
		}
	}

	async savePluginState() {
		await this.saveData({
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

	private async loadPluginState() {
		const persisted = loadPersistedData(await this.loadData());
		this.settings = persisted.settings;
		this.state = persisted.state;
	}

	private async performSync(options?: {
		successNotice?: boolean;
		failureNotice?: boolean;
	}) {
		const successNotice = options?.successNotice ?? true;
		const failureNotice = options?.failureNotice ?? true;
		try {
			this.setStatus(t('statusSyncingFolder'));
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
			this.appendLog('info', 'sync', summary);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(t('statusSyncFailed'));
			if (failureNotice) {
				new Notice(t('noticeSyncFailed', { message }), 12000);
			}
			this.appendLog('error', 'sync', 'Folder sync failed', message);
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

	private async runLifecycleSync(trigger: 'startup' | 'shutdown') {
		if (!this.isSyncConfigured()) {
			this.appendLog(
				'info',
				trigger,
				`Skipped ${trigger} sync because Wiz sync is not fully configured`,
			);
			return;
		}

		if (trigger === 'shutdown') {
			this.clearAutoSyncTimer();
		}

		await this.runManagedSync({
			scope: trigger,
			startMessage:
				trigger === 'startup'
					? 'Startup sync started'
					: 'Shutdown sync started',
			notifyIfRunning: false,
			successNotice: false,
			failureNotice: trigger === 'startup',
		});
	}

	private isSyncConfigured(): boolean {
		return (
			this.settings.accountBaseUrl.trim().length > 0 &&
			this.settings.userId.trim().length > 0 &&
			this.settings.password.length > 0 &&
			this.settings.targetCategory.trim().length > 0
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
		if (!isFileInSourceFolder(file.path, sourceFolder)) {
			return;
		}

		this.pendingAutoSyncPaths.add(file.path);
		this.appendLog('info', 'watch', `Queued auto sync for ${file.path}`);
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
		this.appendLog('info', 'vault', `Renamed note ${oldPath} -> ${file.path}`);
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
			this.appendLog('info', 'vault', `Renamed folder ${oldPath} -> ${folder.path}`);
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
			this.appendLog('info', 'delete', `Moved remote note to trash for ${path}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('noticeRemoteDeleteFailed', { message }), 10000);
			this.appendLog('error', 'delete', `Failed to trash remote note for ${path}`, message);
			throw error;
		}
	}

	private async handleRemoteFolderDelete(folderPath: string) {
		const sourceFolder = this.normalizeSourceFolder();
		if (!isFileInSourceFolder(folderPath, sourceFolder)) {
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
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('noticeRemoteFolderDeleteFailed', { message }), 10000);
			this.appendLog(
				'error',
				'delete',
				`Failed to trash remote folder subtree for ${folderPath}`,
				message,
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
		const targetCategory = normalizeCategoryPath(this.settings.targetCategory);
		if (!sourceFolder || folderPath !== sourceFolder) {
			const relativePath = sourceFolder
				? folderPath.slice(sourceFolder.length + 1)
				: folderPath;
			if (relativePath) {
				return normalizeCategoryPath(`${targetCategory}${relativePath}`);
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
				this.appendLog('info', 'autosync', `Auto syncing ${file.path}`);
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
			} catch (error) {
				failed += 1;
				console.error(`[wiz-folder-sync] Auto sync failed for ${path}`, error);
				this.appendLog(
					'error',
					'autosync',
					`Auto sync failed for ${path}`,
					error instanceof Error ? error.message : String(error),
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
		this.appendLog('info', 'autosync', summary);
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
		this.state.logs = [...this.state.logs, entry].slice(-300);
		this.refreshSyncLogView();
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
