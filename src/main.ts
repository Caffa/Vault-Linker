import { App, Plugin, TFile, debounce, Notice, MarkdownRenderer, FileSystemAdapter } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS, VaultLinkerSettings, VaultLinkerSettingTab } from './settings';

interface FileInfo {
	path: string;
	mtime: number;
}

interface VaultIndex {
	files: Record<string, FileInfo>;
}

export default class VaultLinkerPlugin extends Plugin {
	settings: VaultLinkerSettings;
	globalIndex: Map<string, { vaultPath: string; fileInfo: FileInfo }[]> = new Map();
    lastOpenTime: number = 0;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new VaultLinkerSettingTab(this.app, this));
        this.applyStyles();

		this.app.workspace.onLayoutReady(() => {
			this.generateLocalIndex();
			this.loadRemoteIndices();
            this.registerDomEvents();
            this.initDomObserver();
		});

        const debouncedGen = debounce(() => this.generateLocalIndex(), 5000, true);
        this.registerEvent(this.app.vault.on('create', debouncedGen));
        this.registerEvent(this.app.vault.on('delete', debouncedGen));
        this.registerEvent(this.app.vault.on('rename', debouncedGen));

        this.addCommand({
            id: 'refresh-cross-vault-indices',
            name: 'Refresh Cross-Vault Indices',
            callback: () => {
                this.generateLocalIndex();
                this.loadRemoteIndices();
                new Notice('Cross-vault indices refreshed');
            }
        });

        // Reading Mode Support via PostProcessor
        this.registerMarkdownPostProcessor((element, context) => {
            const embeds = element.querySelectorAll('.internal-embed');
            embeds.forEach(async (embed) => {
                await this.processEmbed(embed as HTMLElement);
            });

            const links = element.querySelectorAll('.internal-link.is-unresolved');
            links.forEach((link) => {
                const href = link.getAttribute('data-href');
                if (href && this.isRemoteMatch(href)) {
                    link.addClass('cross-vault-link');
                }
            });
        });
	}

    applyStyles() {
        document.body.style.setProperty('--cross-vault-link-color', this.settings.linkTextColor);
        document.body.style.setProperty('--cross-vault-embed-bg', this.settings.embedBackgroundColor);
    }

    initDomObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' || mutation.type === 'attributes') {

                    // 1. Handle Links (Styling)
                    const unresolvedLinks = document.querySelectorAll('.is-unresolved');
                    unresolvedLinks.forEach(el => {
                        if (el.hasClass('cross-vault-link')) return;

                        let href = el.getAttribute('data-href');
                        if (!href && el.classList.contains('cm-hmd-internal-link')) {
                             const text = el.textContent;
                             if (text && text.length > 4) {
                                 href = text.replace(/^\[\[/, '').replace(/\]\]$/, '');
                             }
                        }

                        if (href && this.isRemoteMatch(href)) {
                            el.addClass('cross-vault-link');
                        }
                    });

                    // 2. Handle Embeds (Rendering)
                    const embeds = document.querySelectorAll('.internal-embed, .markdown-embed');
                    embeds.forEach(async (embed) => {
                         await this.processEmbed(embed as HTMLElement);
                    });
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src'] });
        this.register(() => observer.disconnect());
    }

    async processEmbed(embed: HTMLElement) {
        if (embed.hasClass('cross-vault-processed')) return;

        const isUnresolved = embed.classList.contains('is-unresolved') || embed.classList.contains('file-embed');

        const src = embed.getAttribute('src');
        if (!src) return;

        if (this.isFileResolvedLocally(src)) return;

        if (this.isRemoteMatch(src)) {
             await this.renderRemoteEmbed(embed, src);
        }
    }

    isFileResolvedLocally(pathStr: string): boolean {
        const sourcePath = this.app.workspace.getActiveFile()?.path || '';
        const dest = this.app.metadataCache.getFirstLinkpathDest(pathStr, sourcePath);
        return !!dest;
    }

    isRemoteMatch(href: string): boolean {
        let lookupName = href;
        if (href.includes('#')) lookupName = href.split('#')[0];
        const targetFilename = this.normalizeFilename(path.basename(lookupName));
        return this.globalIndex.has(targetFilename);
    }

    registerDomEvents() {
        const handleEvent = (evt: MouseEvent) => {
            if (evt.button !== 0) return;

            const target = evt.target as HTMLElement;
            let href = target.getAttribute('data-href');

            if (!href) {
                const parentLink = target.closest('.internal-link, .cm-hmd-internal-link, .cm-link, .cm-underline');
                if (parentLink) {
                    href = parentLink.getAttribute('data-href');
                    if (!href) {
                         const text = parentLink.textContent || "";
                         if (parentLink.classList.contains('is-unresolved')) {
                             href = text.replace(/^\[\[/, '').replace(/\]\]$/, '');
                         }
                    }
                }
            }

            if (href && !this.isLinkResolvedLocally(href)) {
                 this.handleUnresolvedLink(evt, href);
            }
        };

        this.registerDomEvent(window, 'click', handleEvent, { capture: true });
        this.registerDomEvent(window, 'mousedown', handleEvent, { capture: true });
        this.registerDomEvent(window, 'mouseup', handleEvent, { capture: true });
    }

    isLinkResolvedLocally(href: string): boolean {
        const sourcePath = this.app.workspace.getActiveFile()?.path || '';
        const dest = this.app.metadataCache.getFirstLinkpathDest(href, sourcePath);
        return !!dest;
    }

    handleUnresolvedLink(evt: MouseEvent, href: string) {
        const targetFilename = this.normalizeFilename(path.basename(href));
        const matches = this.globalIndex.get(targetFilename);

        if (matches && matches.length > 0) {
            evt.preventDefault();
            evt.stopPropagation();
            evt.stopImmediatePropagation();

            if (evt.type === 'click') {
                 const now = Date.now();
                 if (now - this.lastOpenTime < 500) return;
                 this.lastOpenTime = now;

                const bestMatch = matches[0];
                const vaultName = path.basename(bestMatch.vaultPath);
                const encodedFile = encodeURIComponent(bestMatch.fileInfo.path);
                const encodedVault = encodeURIComponent(vaultName);

                const uri = `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
                window.open(uri);
            }
        }
    }

    async renderRemoteEmbed(container: HTMLElement, src: string) {
        if (container.hasClass('cross-vault-processed')) return;
        container.addClass('cross-vault-processed');

        let lookupName = src;
        if (src.includes('#')) {
            lookupName = src.split('#')[0];
        }

        const targetFilename = this.normalizeFilename(lookupName);
        const matches = this.globalIndex.get(targetFilename);

        if (matches && matches.length > 0) {
            const match = matches[0];
            const absolutePath = path.join(match.vaultPath, match.fileInfo.path);

            try {
                if (fs.existsSync(absolutePath)) {
                    let content = fs.readFileSync(absolutePath, 'utf-8');
                    content = content.replace(/^---\n[\s\S]*?\n---/, '');

                    container.empty();
                    container.removeClass('is-unresolved');
                    container.addClass('cross-vault-embed');

                    const wrapper = container.createDiv({ cls: 'cross-vault-embed-content' });
                    // Basic styling, specialized styling comes from CSS using vars
                    wrapper.style.minHeight = "50px";
                    wrapper.style.border = "1px solid var(--interactive-accent)";
                    wrapper.style.padding = "10px";
                    wrapper.style.borderRadius = "5px";

                    await MarkdownRenderer.render(this.app, content, wrapper, match.fileInfo.path, this);
                }
            } catch (e) {
                console.error('Cross-Vault: Failed to read/render remote file', e);
            }
        }
    }

    normalizeFilename(name: string): string {
        const ext = path.extname(name);
        return ext ? name : name + '.md';
    }

	generateLocalIndex() {
		const files = this.app.vault.getMarkdownFiles();
		const index: VaultIndex = { files: {} };

		for (const file of files) {
			index.files[file.name] = {
				path: file.path,
				mtime: file.stat.mtime
			};
		}

        let basePath = "";
        if (this.app.vault.adapter instanceof FileSystemAdapter) {
            basePath = this.app.vault.adapter.getBasePath();
        } else {
             basePath = (this.app.vault.adapter as any).basePath;
        }

        if (this.manifest.dir && basePath) {
             const indexPath = path.join(basePath, this.manifest.dir, 'index.json');
             if (!fs.existsSync(path.dirname(indexPath))) {
                 fs.mkdirSync(path.dirname(indexPath), { recursive: true });
             }
             fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
        }
	}

	loadRemoteIndices() {
        this.globalIndex.clear();
		for (const vaultPath of this.settings.neighborVaults) {
			try {
				const indexPath = path.join(vaultPath, '.obsidian', 'plugins', 'cross-vault-connect', 'index.json');
				if (fs.existsSync(indexPath)) {
					const indexContent = fs.readFileSync(indexPath, 'utf-8');
					const index = JSON.parse(indexContent) as VaultIndex;

                    for (const [filename, info] of Object.entries(index.files)) {
                        if (!this.globalIndex.has(filename)) {
                            this.globalIndex.set(filename, []);
                        }
                        this.globalIndex.get(filename)?.push({
                            vaultPath: vaultPath,
                            fileInfo: info
                        });
                    }
				}
			} catch (e) {
				console.error(`Cross-Vault: Failed to load index from ${vaultPath}`, e);
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
        this.applyStyles(); // Re-apply styles on save
        this.loadRemoteIndices();
	}
}
