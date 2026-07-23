import WizFolderSyncPlugin from './main';
import { t } from './i18n';

export function registerCommands(plugin: WizFolderSyncPlugin) {
	plugin.addCommand({
		id: 'sync-folder-to-wiz',
		name: t('commandSyncFolder'),
		callback: async () => {
			await plugin.runSyncCommand();
		},
	});

	plugin.addCommand({
		id: 'test-wiz-connection',
		name: t('commandTestConnection'),
		callback: async () => {
			await plugin.testConnectionCommand();
		},
	});

	plugin.addCommand({
		id: 'open-sync-log-panel',
		name: t('commandOpenSyncLog'),
		callback: async () => {
			await plugin.openSyncLogView();
		},
	});
}
