import {
	ItemView,
	type WorkspaceLeaf,
	setIcon,
} from 'obsidian';
import { t } from '../i18n';
import type { DebugLogEntry } from '../settings';
import type WizFolderSyncPlugin from '../main';

export const SYNC_LOG_VIEW_TYPE = 'wiz-folder-sync-log-view';

export class WizSyncLogView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: WizFolderSyncPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return SYNC_LOG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('logViewTitle');
	}

	getIcon(): string {
		return 'scroll-text';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	refresh() {
		this.render();
	}

	private render() {
		const { containerEl } = this;
		containerEl.empty();

		const header = containerEl.createDiv({ cls: 'wiz-sync-log__header' });
		header.createEl('h2', { text: t('logViewTitle') });
		const actions = header.createDiv({ cls: 'wiz-sync-log__actions' });

		const refreshButton = actions.createEl('button', {
			text: t('buttonSyncNow'),
		});
		refreshButton.addEventListener('click', () => {
			void this.plugin.runSyncCommand();
		});

		const clearButton = actions.createEl('button', {
			text: t('buttonClearLogs'),
		});
		clearButton.addEventListener('click', () => {
			void this.plugin.clearDebugLogs();
		});

		const logContainer = containerEl.createDiv({ cls: 'wiz-sync-log__list' });
		const logs = [...this.plugin.getDebugLogs()].reverse();
		if (logs.length === 0) {
			logContainer.createEl('p', { text: t('logPanelEmpty') });
			return;
		}

		for (const entry of logs) {
			this.renderLogEntry(logContainer, entry);
		}
	}

	private renderLogEntry(parent: HTMLElement, entry: DebugLogEntry) {
		const item = parent.createDiv({
			cls: `wiz-sync-log__item wiz-sync-log__item--${entry.level}`,
		});

		const meta = item.createDiv({ cls: 'wiz-sync-log__meta' });
		meta.createSpan({
			text: formatTimestamp(entry.at),
			cls: 'wiz-sync-log__time',
		});
		meta.createSpan({
			text: this.getLevelLabel(entry.level),
			cls: 'wiz-sync-log__level',
		});
		meta.createSpan({
			text: entry.scope,
			cls: 'wiz-sync-log__scope',
		});

		item.createDiv({
			text: entry.message,
			cls: 'wiz-sync-log__message',
		});

		if (entry.detail) {
			const detail = item.createEl('details', { cls: 'wiz-sync-log__detail' });
			detail.createEl('summary', { text: 'Details' });
			detail.createEl('pre', { text: entry.detail });
		}
	}

	private getLevelLabel(level: DebugLogEntry['level']): string {
		switch (level) {
			case 'warn':
				return t('logLevelWarn');
			case 'error':
				return t('logLevelError');
			case 'info':
			default:
				return t('logLevelInfo');
		}
	}
}

export async function activateSyncLogView(
	plugin: WizFolderSyncPlugin,
): Promise<void> {
	const leaf = plugin.app.workspace.getRightLeaf(false);
	if (!leaf) {
		return;
	}

	await leaf.setViewState({
		type: SYNC_LOG_VIEW_TYPE,
		active: true,
	});
	void plugin.app.workspace.revealLeaf(leaf);
}

export function decorateSyncLogTab(tabEl: HTMLElement) {
	setIcon(tabEl, 'scroll-text');
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).format(date);
}
