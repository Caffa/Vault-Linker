import { App, PluginSettingTab, Setting } from "obsidian";
import VaultLinkerPlugin from "./main";

export interface VaultLinkerSettings {
	neighborVaults: string[];
    linkTextColor: string;
    embedBackgroundColor: string;
}

export const DEFAULT_SETTINGS: VaultLinkerSettings = {
	neighborVaults: [],
    linkTextColor: '#00b894',
    embedBackgroundColor: 'rgba(106, 13, 173, 0.05)'
}

export class VaultLinkerSettingTab extends PluginSettingTab {
	plugin: VaultLinkerPlugin;

	constructor(app: App, plugin: VaultLinkerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
        containerEl.createEl('h2', {text: 'Vault Linker Settings'});

		new Setting(containerEl)
			.setName('Neighbor Vaults')
			.setDesc('Add absolute paths to other vaults (one per line).')
			.addTextArea(text => text
				.setPlaceholder('/path/to/VaultA\n/path/to/VaultB')
				.setValue(this.plugin.settings.neighborVaults.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.neighborVaults = value.split('\n').filter(v => v.trim() !== '');
					await this.plugin.saveSettings();
				}));

        new Setting(containerEl)
            .setName('Link Color')
            .setDesc('CSS color for cross-vault links (e.g., #00b894 or red).')
            .addText(text => text
                .setValue(this.plugin.settings.linkTextColor)
                .onChange(async (value) => {
                    this.plugin.settings.linkTextColor = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Embed Background Color')
            .setDesc('CSS color for cross-vault embed background.')
            .addText(text => text
                .setValue(this.plugin.settings.embedBackgroundColor)
                .onChange(async (value) => {
                    this.plugin.settings.embedBackgroundColor = value;
                    await this.plugin.saveSettings();
                }));
	}
}
