import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import VaultLinkerPlugin from "./main";
import * as path from 'path';

export interface VaultLinkerSettings {
	neighborVaults: string[];
    discoveredVaults: string[]; // Vaults found via back-linking or scanning but not yet enabled
    parentVaultFolder: string;
    linkTextColor: string;
    embedBackgroundColor: string;
}

export const DEFAULT_SETTINGS: VaultLinkerSettings = {
	neighborVaults: [],
    discoveredVaults: [],
    parentVaultFolder: '',
    linkTextColor: '#00b894',
    embedBackgroundColor: '#f5e6fa'
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

        this.addVaultDiscoverySection(containerEl);
        this.addStyleSection(containerEl);
	}

    addVaultDiscoverySection(containerEl: HTMLElement) {
        containerEl.createEl('h3', {text: 'Vault Connections'});

        // 1. Parent Folder Scanner
        new Setting(containerEl)
            .setName('Parent folder for vaults')
            .setDesc('A folder containing other vaults you want to link to.')
            .addText(text => {
                const adapter = this.app.vault.adapter as any;
                const defaultPath = adapter.basePath ? path.dirname(adapter.basePath) : '/Users/me/Notes';

                // If setting is empty, show default as value (and distinct placeholder)
                const currentValue = this.plugin.settings.parentVaultFolder;

                text.setPlaceholder(defaultPath)
                    .setValue(currentValue || defaultPath) // Pre-fill with default if empty
                    .onChange(async (value) => {
                        this.plugin.settings.parentVaultFolder = value;
                        await this.plugin.saveSettings();
                    });
            })
            .addButton(btn => btn
                .setButtonText('Browse')
                .onClick(async () => {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        const { remote } = require('electron');
                        const result = await remote.dialog.showOpenDialog({
                            properties: ['openDirectory']
                        });

                        if (!result.canceled && result.filePaths.length > 0) {
                            this.plugin.settings.parentVaultFolder = result.filePaths[0];
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    } catch (e) {
                        console.error("Vault Linker: Browse failed", e);
                        new Notice("Browse failed. Please enter path manually.");
                    }
                }));

        // Scan Button
        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText('Scan for Vaults')
                .setCta()
                .onClick(async () => {
                    if (this.plugin.settings.parentVaultFolder) {
                        const vaults = await this.plugin.scanForVaults(this.plugin.settings.parentVaultFolder);
                        // Add found vaults to discovered if not already known
                        let changed = false;
                        for (const v of vaults) {
                            if (!this.plugin.settings.neighborVaults.includes(v) &&
                                !this.plugin.settings.discoveredVaults.includes(v) &&
                                v !== (this.app.vault.adapter as any).basePath) {
                                this.plugin.settings.discoveredVaults.push(v);
                                changed = true;
                            }
                        }
                        if (changed) await this.plugin.saveSettings();
                        if (vaults.length > 0) new Notice(`Found ${vaults.length} vaults.`);
                        else new Notice('No vaults found in parent folder.');
                        this.display();
                    } else {
                        new Notice('Please set a parent folder first.');
                    }
                }));

        // 2. Add Single Vault Button
        new Setting(containerEl)
            .setName('Add specific vault')
            .setDesc('Select a specific vault folder to add.')
            .addButton(btn => btn
                .setButtonText('Browse & Add')
                .onClick(async () => {
                     try {
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        const { remote } = require('electron');
                        const result = await remote.dialog.showOpenDialog({
                            properties: ['openDirectory']
                        });

                        if (!result.canceled && result.filePaths.length > 0) {
                            const pathStr = result.filePaths[0];
                            if (this.plugin.isVault(pathStr)) {
                                await this.plugin.addNeighborVault(pathStr);
                                this.display();
                            } else {
                                new Notice('Selected folder is not an Obsidian vault.');
                            }
                        }
                    } catch (e) {
                        console.error("Vault Linker: Browse failed", e);
                        new Notice("Browse failed. Please enter path manually.");
                    }
                }));


        // 3. Vault List (Active + Discovered)
        containerEl.createEl('h4', {text: 'Connected & Discovered Vaults'});

        // Combine all unique paths
        const allVaults = Array.from(new Set([
            ...this.plugin.settings.neighborVaults,
            ...this.plugin.settings.discoveredVaults
        ]));

        if (allVaults.length === 0) {
            containerEl.createEl('p', {text: 'No vaults connected yet.', cls: 'setting-item-description'});
        }

        allVaults.forEach(vaultPath => {
            const isConnected = this.plugin.settings.neighborVaults.includes(vaultPath);
            const name = path.basename(vaultPath);

            new Setting(containerEl)
                .setName(name)
                .setDesc(vaultPath)
                .addToggle(toggle => toggle
                    .setValue(isConnected)
                    .onChange(async (value) => {
                        if (value) {
                            // Enable
                            if (!this.plugin.settings.neighborVaults.includes(vaultPath)) {
                                this.plugin.settings.neighborVaults.push(vaultPath);
                                // Also ensure bidirectional link when explicitly enabling
                                await this.plugin.ensureBidirectionalLink(vaultPath);
                            }
                            // Remove from discovered as it is now active
                            this.plugin.settings.discoveredVaults = this.plugin.settings.discoveredVaults.filter(v => v !== vaultPath);
                        } else {
                            // Disable
                            this.plugin.settings.neighborVaults = this.plugin.settings.neighborVaults.filter(v => v !== vaultPath);
                            // Add back to discovered so it doesn't disappear
                            if (!this.plugin.settings.discoveredVaults.includes(vaultPath)) {
                                this.plugin.settings.discoveredVaults.push(vaultPath);
                            }
                        }
                        await this.plugin.saveSettings();
                        // We don't necessarily need to re-render the whole list, but it keeps order if we sorted.
                        // Here we just stay put.
                    }))
                .addExtraButton(btn => btn
                    .setIcon('trash')
                    .setTooltip('Forget this vault')
                    .onClick(async () => {
                        this.plugin.settings.neighborVaults = this.plugin.settings.neighborVaults.filter(v => v !== vaultPath);
                        this.plugin.settings.discoveredVaults = this.plugin.settings.discoveredVaults.filter(v => v !== vaultPath);
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        });
    }

    addStyleSection(containerEl: HTMLElement) {
        containerEl.createEl('h3', {text: 'Styling'});

        new Setting(containerEl)
            .setName('Link color')
            .setDesc('Hex color for cross-vault links.')
            .addColorPicker(picker => picker
                .setValue(this.plugin.settings.linkTextColor)
                .onChange(async (value) => {
                    this.plugin.settings.linkTextColor = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Embed background color')
            .setDesc('Hex color for cross-vault embed background.')
            .addColorPicker(picker => picker
                .setValue(this.plugin.settings.embedBackgroundColor)
                .onChange(async (value) => {
                    this.plugin.settings.embedBackgroundColor = value;
                    await this.plugin.saveSettings();
                }));
	}
}
