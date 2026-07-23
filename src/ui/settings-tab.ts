import { App, PluginSettingTab, Setting } from 'obsidian';
import { t } from '../i18n';
import WizFolderSyncPlugin from '../main';

export class WizFolderSyncSettingTab extends PluginSettingTab {
	plugin: WizFolderSyncPlugin;

	constructor(app: App, plugin: WizFolderSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions() {
		return [];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(t('headingSync')).setHeading();
		containerEl.createEl('p', {
			text: t('settingsIntro'),
		});

		new Setting(containerEl)
			.setName(t('settingAccountServerName'))
			.setDesc(t('settingAccountServerDesc'))
			.addText((text) =>
				text
					.setPlaceholder('https://note.wiz.cn')
					.setValue(this.plugin.settings.accountBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.accountBaseUrl = value.trim();
						await this.plugin.savePluginState();
					}),
			);

		new Setting(containerEl)
			.setName(t('settingWizAccountName'))
			.setDesc(t('settingWizAccountDesc'))
			.addText((text) =>
				text
					.setPlaceholder('name@example.com')
					.setValue(this.plugin.settings.userId)
					.onChange(async (value) => {
						this.plugin.settings.userId = value.trim();
						await this.plugin.savePluginState();
					}),
			);

		new Setting(containerEl)
			.setName(t('settingWizPasswordName'))
			.setDesc(t('settingWizPasswordDesc'))
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder(t('placeholderPassword'))
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.savePluginState();
					});
			});

		new Setting(containerEl)
			.setName(t('settingSourceFolderName'))
			.setDesc(t('settingSourceFolderDesc'))
			.addText((text) =>
				text
					.setPlaceholder(t('placeholderSourceFolder'))
					.setValue(this.plugin.settings.sourceFolder)
					.onChange(async (value) => {
						this.plugin.settings.sourceFolder = value.trim();
						await this.plugin.savePluginState();
					}),
			);

		new Setting(containerEl)
			.setName(t('settingTargetCategoryName'))
			.setDesc(t('settingTargetCategoryDesc'))
			.addText((text) =>
				text
					.setPlaceholder(t('placeholderTargetCategory'))
					.setValue(this.plugin.settings.targetCategory)
					.onChange(async (value) => {
						this.plugin.settings.targetCategory = value.trim();
						await this.plugin.savePluginState();
					}),
			);

		new Setting(containerEl)
			.setName(t('settingSyncModeName'))
			.setDesc(t('settingSyncModeDesc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('bidirectional', t('settingSyncModeBidirectional'))
					.addOption(
						'local-to-remote',
						t('settingSyncModeLocalToRemote'),
					)
					.addOption(
						'remote-to-local',
						t('settingSyncModeRemoteToLocal'),
					)
					.setValue(this.plugin.settings.syncMode)
					.onChange(async (value) => {
						this.plugin.settings.syncMode =
							value === 'local-to-remote' ||
							value === 'remote-to-local'
								? value
								: 'bidirectional';
						await this.plugin.savePluginState();
					}),
			);

		new Setting(containerEl)
			.setName(t('settingAutoSyncName'))
			.setDesc(t('settingAutoSyncDesc'))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSyncOnSave)
					.onChange(async (value) => {
						this.plugin.settings.autoSyncOnSave = value;
						await this.plugin.savePluginState();
					}),
			);

		new Setting(containerEl)
			.setName(t('settingAutoSyncDebounceName'))
			.setDesc(t('settingAutoSyncDebounceDesc'))
			.addText((text) =>
				text
					.setPlaceholder('1500')
					.setValue(String(this.plugin.settings.autoSyncDebounceMs))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value.trim(), 10);
						this.plugin.settings.autoSyncDebounceMs = Number.isFinite(parsed)
							? Math.max(300, Math.min(30000, parsed))
							: 1500;
						await this.plugin.savePluginState();
					}),
			);

		new Setting(containerEl)
			.setName(t('settingActionsName'))
			.setDesc(t('settingActionsDesc'))
			.addButton((button) =>
				button.setButtonText(t('buttonTestConnection')).onClick(async () => {
					await this.plugin.testConnectionCommand();
				}),
			)
			.addButton((button) =>
				button.setButtonText(t('buttonSyncNow')).setCta().onClick(async () => {
					await this.plugin.runSyncCommand();
				}),
			)
			.addButton((button) =>
				button.setButtonText(t('buttonClearMap')).onClick(async () => {
					await this.plugin.clearSyncState();
				}),
			);

		new Setting(containerEl)
			.setName(t('headingDebug'))
			.setDesc(t('settingDebugActionsDesc'))
			.addButton((button) =>
				button
					.setButtonText(t('buttonOpenSyncLog'))
					.onClick(async () => {
						await this.plugin.openSyncLogView();
					}),
			)
			.addButton((button) =>
				button.setButtonText(t('buttonClearLogs')).onClick(async () => {
					await this.plugin.clearDebugLogs();
				}),
			);
	}
}
