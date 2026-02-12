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

// Helper to deduce the plugin directory name for cross-vault settings modification
const PLUGIN_ID = "vault-linker"; // From manifest.json


export default class VaultLinkerPlugin extends Plugin {
	settings: VaultLinkerSettings;
	globalIndex: Map<string, { vaultPath: string; fileInfo: FileInfo }[]> = new Map();
    negativeCache: Set<string> = new Set();
    normalizationCache: Map<string, string> = new Map();
    lookupCache: Map<string, { vaultPath: string; fileInfo: FileInfo }[] | null> = new Map();
    lastOpenTime: number = 0;
    isLoadingIndices: boolean = false;

	async onload() {
		await this.loadSettings();

        // 1. Set default parent folder if empty
        if (!this.settings.parentVaultFolder) {
            const adapter = this.app.vault.adapter;
            if (adapter instanceof FileSystemAdapter) {
                const basePath = adapter.getBasePath();
                console.log("Vault Linker: Base path detected:", basePath);
                if (basePath) {
                    const parentDir = path.dirname(basePath);
                    this.settings.parentVaultFolder = parentDir;
                    console.log("Vault Linker: Setting default parent folder to:", parentDir);
                    await this.saveSettings();
                }
            }
        } else {
            console.log("Vault Linker: Parent folder already set to:", this.settings.parentVaultFolder);
        }

		this.addSettingTab(new VaultLinkerSettingTab(this.app, this));
        this.applyStyles();

		this.app.workspace.onLayoutReady(() => {
			this.generateLocalIndex();
			this.loadRemoteIndices(); // No await here to not block layout ready, but it's async now
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

            // Reading mode: internal-link.is-unresolved | Live Preview: cm-hmd-internal-link
            const links = element.querySelectorAll('.internal-link.is-unresolved, .cm-hmd-internal-link');
            links.forEach((link) => this.processLink(link as HTMLElement));
        });
	}

    applyStyles() {
        document.body.style.setProperty('--cross-vault-link-color', this.settings.linkTextColor);
        document.body.style.setProperty('--cross-vault-embed-bg', this.settings.embedBackgroundColor);
    }

    initDomObserver() {
        // Batch pending elements and process them in the next animation frame
        // This prevents jank on large documents with many mutations
        let pendingElements: Set<HTMLElement> = new Set();
        let rafScheduled = false;

        const processBatch = () => {
            rafScheduled = false;
            const elements = Array.from(pendingElements);
            pendingElements.clear();

            for (const el of elements) {
                // Check if the element IS a link or embed
                // Reading mode: internal-link, is-unresolved | Live Preview: cm-hmd-internal-link
                if (el.hasClass('is-unresolved') || el.hasClass('cm-hmd-internal-link')) {
                    this.processLink(el);
                }
                if (el.hasClass('internal-embed')) {
                    this.processEmbed(el);
                }

                // If it's a container, query inside it
                if (el.childElementCount > 0) {
                    const links = el.querySelectorAll('.internal-link.is-unresolved, .cm-hmd-internal-link');
                    links.forEach(link => this.processLink(link as HTMLElement));

                    const embeds = el.querySelectorAll('.internal-embed');
                    embeds.forEach(embed => this.processEmbed(embed as HTMLElement));
                }
            }
        };

        const scheduleProcessing = () => {
            if (!rafScheduled && pendingElements.size > 0) {
                rafScheduled = true;
                requestAnimationFrame(processBatch);
            }
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            pendingElements.add(node as HTMLElement);
                        }
                    });
                } else if (mutation.type === 'attributes') {
                    const el = mutation.target as HTMLElement;
                    // Only add if it's a relevant element
                    if (mutation.attributeName === 'class') {
                        if (el.hasClass('is-unresolved') || el.hasClass('internal-embed') || el.hasClass('cm-hmd-internal-link')) {
                            pendingElements.add(el);
                        }
                    }
                    if (mutation.attributeName === 'src' && el.hasClass('internal-embed')) {
                        pendingElements.add(el);
                    }
                    if (mutation.attributeName === 'data-href' && (el.hasClass('is-unresolved') || el.hasClass('cm-hmd-internal-link'))) {
                        pendingElements.add(el);
                    }
                }
            }
            scheduleProcessing();
        });

        // Observe childList for additions, and attributes for status changes (e.g. link becoming unresolved)
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'src', 'data-href']
        });
        this.register(() => observer.disconnect());
    }

    processLink(el: HTMLElement) {
        if (el.hasClass('cross-vault-link')) return;

        let href = el.getAttribute('data-href');
        const originalHref = href;

        // Fallback: extract from text content for any link element
        if (!href) {
            const text = el.textContent?.trim();
            if (text) {
                // Remove [[ and ]] if present, handle display text (e.g., [[file|display]])
                const extracted = text.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0];
                href = extracted ?? null;
            }
        }

        // Debug log to trace link processing
        console.log(`Vault-Linker: processLink - href=${href}, data-href=${originalHref}, classes=${el.className}`);

        if (href && this.isRemoteMatch(href)) {
            el.addClass('cross-vault-link');
        }
    }

    async processEmbed(embed: HTMLElement) {
        if (embed.hasClass('cross-vault-processed')) return;

        const src = embed.getAttribute('src');
        if (!src) return;

        // Fast check: if we already know this isn't remote, skip
        if (this.negativeCache.has(src)) return;

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
        // Race condition fix: If still loading, don't trust the negative cache
        if (this.isLoadingIndices) return false;

        // Cache Check
        if (this.negativeCache.has(href)) return false;

        const matches = this.lookupInGlobalIndex(href);
        const hasMatch = matches !== null && matches.length > 0;

        // DEBUG: Logging to trace lookups
        if (!hasMatch && !this.negativeCache.has(href)) {
             // Only log misses that aren't already cached to avoid spam
             const [targetFilename] = this.parseLinkHref(href);
             console.log(`Vault-Linker: Miss for '${targetFilename}' (orig: '${href}')`);
        }

        if (!hasMatch) {
            this.negativeCache.add(href);
        }
        return hasMatch;
    }

    registerDomEvents() {
        const handleEvent = (evt: MouseEvent) => {
            if (evt.button !== 0) return;

            const target = evt.target as HTMLElement;
            
            // Check if the click is on a cross-vault link directly or within one
            const crossVaultLink = target.closest('.cross-vault-link') as HTMLElement;
            if (crossVaultLink) {
                // This is definitely a cross-vault link, handle it directly
                let href = crossVaultLink.getAttribute('data-href');
                if (!href) {
                    const text = crossVaultLink.textContent || "";
                    href = text.replace(/^\[\[/, '').replace(/\]\]$/, '');
                }
                if (href) {
                    this.handleCrossVaultLink(evt, href);
                    return;
                }
            }

            // Fallback: check for unresolved links that might be cross-vault
            let href = target.getAttribute('data-href');

            if (!href) {
                const parentLink = target.closest('.internal-link, .cm-hmd-internal-link, .cm-link, .cm-underline');
                if (parentLink) {
                    href = parentLink.getAttribute('data-href');
                    if (!href) {
                        const text = parentLink.textContent?.trim() || "";
                        // Extract href from any unresolved, internal, Live Preview link, or cm-underline (link text in Live Preview)
                        const isInternalLink = parentLink.classList.contains('is-unresolved') ||
                            parentLink.classList.contains('internal-link') ||
                            parentLink.classList.contains('cm-hmd-internal-link') ||
                            (parentLink.classList.contains('cm-underline') && parentLink.closest('.cm-hmd-internal-link'));
                        if (isInternalLink && text) {
                            const extracted = text.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0];
                            href = extracted ?? null;
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

    handleCrossVaultLink(evt: MouseEvent, href: string) {
        const matches = this.lookupInGlobalIndex(href);

        if (matches && matches.length > 0) {
            evt.preventDefault();
            evt.stopPropagation();
            evt.stopImmediatePropagation();

            if (evt.type === 'click') {
                const now = Date.now();
                if (now - this.lastOpenTime < 500) return;
                this.lastOpenTime = now;

                const bestMatch = matches[0];
                if (bestMatch) {
                    const vaultName = path.basename(bestMatch.vaultPath);
                    const encodedFile = encodeURIComponent(bestMatch.fileInfo.path);
                    const encodedVault = encodeURIComponent(vaultName);

                    const uri = `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
                    window.open(uri);
                }
            }
        }
    }

    isLinkResolvedLocally(href: string): boolean {
        // Strip anchor for file lookup - getFirstLinkpathDest doesn't handle block refs
        let linkPath = href;
        if (href.includes('#')) {
            linkPath = href.split('#')[0] || href;
        }
        const sourcePath = this.app.workspace.getActiveFile()?.path || '';
        const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
        return !!dest;
    }

    handleUnresolvedLink(evt: MouseEvent, href: string) {
        const matches = this.lookupInGlobalIndex(href);

        if (matches && matches.length > 0) {
            evt.preventDefault();
            evt.stopPropagation();
            evt.stopImmediatePropagation();

            if (evt.type === 'click') {
                 const now = Date.now();
                 if (now - this.lastOpenTime < 500) return;
                 this.lastOpenTime = now;

                const bestMatch = matches[0];
                if (bestMatch) {
                    const vaultName = path.basename(bestMatch.vaultPath);
                    const encodedFile = encodeURIComponent(bestMatch.fileInfo.path);
                    const encodedVault = encodeURIComponent(vaultName);

                    const uri = `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
                    window.open(uri);
                }
            }
        }
    }

    async renderRemoteEmbed(container: HTMLElement, src: string) {
        if (container.hasClass('cross-vault-processed')) return;
        container.addClass('cross-vault-processed');

        const [, reference] = this.parseLinkHref(src);
        const matches = this.lookupInGlobalIndex(src);

        if (matches && matches.length > 0) {
            const match = matches[0];
            if (!match) return; // Should not happen given length check but TS is strict

            const absolutePath = path.join(match.vaultPath, match.fileInfo.path);

            try {
                if (fs.existsSync(absolutePath)) {
                    let content = await fs.promises.readFile(absolutePath, 'utf-8');
                    // Strip frontmatter
                    content = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

                    // Extract specific block/heading if reference exists
                    if (reference) {
                        content = this.extractBlockContent(content, reference);
                    }

                    container.empty();
                    container.removeClass('is-unresolved');
                    container.addClass('cross-vault-embed');

                    const wrapper = container.createDiv({ cls: 'cross-vault-embed-content' });
                    // Basic styling, specialized styling comes from CSS using vars
                    wrapper.style.minHeight = "50px";
                    wrapper.style.border = "1px solid var(--interactive-accent)";
                    wrapper.style.padding = "10px";
                    wrapper.style.borderRadius = "5px";
                    wrapper.style.cursor = "pointer";

                    // Store data for click handler
                    const vaultName = path.basename(match.vaultPath);
                    wrapper.dataset.vaultName = vaultName;
                    wrapper.dataset.filePath = match.fileInfo.path;

                    // Add click handler to open file in other vault
                    wrapper.addEventListener('click', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        const encodedFile = encodeURIComponent(wrapper.dataset.filePath || '');
                        const encodedVault = encodeURIComponent(wrapper.dataset.vaultName || '');
                        const uri = `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
                        window.open(uri);
                    });

                    await MarkdownRenderer.render(this.app, content, wrapper, match.fileInfo.path, this);
                }
            } catch (e) {
                console.error('Cross-Vault: Failed to read/render remote file', e);
            }
        }
    }

    normalizeFilename(name: string): string {
        if (this.normalizationCache.has(name)) {
            return this.normalizationCache.get(name)!;
        }
        const ext = path.extname(name);
        const result = ext ? name : name + '.md';
        this.normalizationCache.set(name, result);
        return result;
    }

    /**
     * Parse a link href into normalized filename and anchor.
     * Strips the # anchor portion and normalizes the filename for index lookup.
     * @param href The link href (e.g., "2026-02-12#^val4u1" or "Note Name")
     * @returns [normalizedFilename, anchor] tuple
     */
    parseLinkHref(href: string): [string, string] {
        let lookupName = href;
        let anchor = '';
        if (href.includes('#')) {
            const parts = href.split('#');
            lookupName = parts[0] || href;
            anchor = parts[1] || '';
        }
        // Skip path.basename if lookupName is already a simple filename (no path separators)
        const baseName = lookupName.includes('/') || lookupName.includes('\\')
            ? path.basename(lookupName)
            : lookupName;
        const filename = this.normalizeFilename(baseName);
        return [filename, anchor];
    }

    /**
     * Look up a href in the global index with caching.
     * Caches both positive and negative results for better performance.
     * @param href The link href to look up
     * @returns Array of matches or null if not found
     */
    lookupInGlobalIndex(href: string): { vaultPath: string; fileInfo: FileInfo }[] | null {
        if (this.lookupCache.has(href)) {
            return this.lookupCache.get(href) || null;
        }

        const [filename] = this.parseLinkHref(href);
        const result = this.globalIndex.get(filename) || null;
        this.lookupCache.set(href, result);
        return result;
    }

    /**
     * Extract specific block or heading content from full file content.
     * @param content The full file content (frontmatter already stripped)
     * @param reference The reference after # (e.g., "^blockid" or "Heading Name")
     * @returns The extracted content, or full content if no reference or not found
     */
    extractBlockContent(content: string, reference: string): string {
        if (!reference) return content;

        const lines = content.split('\n');

        // Block reference (^blockid)
        if (reference.startsWith('^')) {
            const blockId = reference; // Keep the ^ for matching
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;
                // Block ID appears at end of line, possibly with trailing whitespace
                if (line.trimEnd().endsWith(blockId)) {
                    // Return just this line/block, removing the block ID itself
                    const cleanedLine = line.replace(new RegExp('\\s*\\' + blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '');
                    return cleanedLine.trim();
                }
            }
            // Block ID not found, return full content
            console.warn(`Vault-Linker: Block reference ${reference} not found`);
            return content;
        }

        // Heading reference
        // Find the heading line (any level: #, ##, ###, etc.)
        const headingRegex = new RegExp(`^(#+)\\s+${reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
        let headingLineIndex = -1;
        let headingLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const currentLine = lines[i];
            if (!currentLine) continue;
            const match = currentLine.match(headingRegex);
            if (match && match[1]) {
                headingLineIndex = i;
                headingLevel = match[1].length;
                break;
            }
        }

        if (headingLineIndex === -1) {
            // Heading not found, return full content
            console.warn(`Vault-Linker: Heading reference "${reference}" not found`);
            return content;
        }

        // Find the end: next heading of same or higher level (fewer or equal #)
        let endLineIndex = lines.length;
        for (let i = headingLineIndex + 1; i < lines.length; i++) {
            const currentLine = lines[i];
            if (!currentLine) continue;
            const headingMatch = currentLine.match(/^(#+)\s+/);
            if (headingMatch && headingMatch[1] && headingMatch[1].length <= headingLevel) {
                endLineIndex = i;
                break;
            }
        }

        // Extract from heading to end
        return lines.slice(headingLineIndex, endLineIndex).join('\n').trim();
    }

	async generateLocalIndex() {
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
             try {
                 await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2));
             } catch (e) {
                 console.error("Failed to write local index", e);
             }
        }
	}

	async loadRemoteIndices() {
        this.isLoadingIndices = true;
        this.globalIndex.clear();
        this.negativeCache.clear();
        this.normalizationCache.clear();
        this.lookupCache.clear();

        // Load all indices in parallel for better performance
        const loadPromises = this.settings.neighborVaults.map(vaultPath => 
            this.loadSingleRemoteIndex(vaultPath)
        );
        await Promise.all(loadPromises);

        this.isLoadingIndices = false;
        // After loading, clear caches again (in case race happened)
        // and trigger a UI refresh to catch links that rendered while we were loading
        this.negativeCache.clear();
        this.lookupCache.clear();
        this.refreshActiveLeaves();
	}

    /**
     * Load index from a single remote vault and merge into globalIndex.
     * @param vaultPath Path to the remote vault
     */
    private async loadSingleRemoteIndex(vaultPath: string): Promise<void> {
        try {
            // Try standard ID first, then fallback
            let indexPath = path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID, 'index.json');

            if (!fs.existsSync(indexPath)) {
                indexPath = path.join(vaultPath, '.obsidian', 'plugins', 'Vault-Linker', 'index.json');
            }

            if (fs.existsSync(indexPath)) {
                console.log(`Vault-Linker: Loading index from ${indexPath}`);
                const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
                const index = JSON.parse(indexContent) as VaultIndex;
                console.log(`Vault-Linker: Loaded ${Object.keys(index.files).length} files from ${vaultPath}`);

                for (const [filename, info] of Object.entries(index.files)) {
                    if (!this.globalIndex.has(filename)) {
                        this.globalIndex.set(filename, []);
                    }
                    this.globalIndex.get(filename)?.push({
                        vaultPath: vaultPath,
                        fileInfo: info
                    });
                }
            } else {
                console.log(`Vault-Linker: No index found at ${indexPath} (checked variants)`);
            }
        } catch (e) {
            console.error(`Cross-Vault: Failed to load index from ${vaultPath}`, e);
        }
    }

    refreshActiveLeaves() {
        // Re-process all links in the DOM to ensure we catch any that were missed during load
        // Reading mode: internal-link.is-unresolved | Live Preview: cm-hmd-internal-link
        const links = document.querySelectorAll('.internal-link.is-unresolved, .cm-hmd-internal-link');
        links.forEach(link => this.processLink(link as HTMLElement));

        const embeds = document.querySelectorAll('.internal-embed');
        embeds.forEach(embed => this.processEmbed(embed as HTMLElement));
    }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}


	async saveSettings() {
		await this.saveData(this.settings);
        this.applyStyles(); // Re-apply styles on save
        await this.loadRemoteIndices();
	}

    // --- Vault Discovery & Linking Logic ---

    async scanForVaults(parentPath: string): Promise<string[]> {
        if (!fs.existsSync(parentPath)) return [];

        try {
            const subdirs = fs.readdirSync(parentPath, { withFileTypes: true });
            const vaultPaths: string[] = [];

            for (const dirent of subdirs) {
                if (dirent.isDirectory()) {
                    const fullPath = path.join(parentPath, dirent.name);
                    try {
                        if (this.isVault(fullPath)) {
                            vaultPaths.push(fullPath);
                        }
                    } catch (err) {
                        // Ignore individual folder errors (e.g. permission denied)
                        console.debug(`Skipping scan of ${fullPath} due to error:`, err);
                    }
                }
            }
            return vaultPaths;
        } catch (e: any) {
            console.error(`Failed to scan parent folder: ${parentPath}`, e);
            new Notice(`Error scanning folder: ${e.message}`);
            return [];
        }
    }

    isVault(dirPath: string): boolean {
        const configPath = path.join(dirPath, '.obsidian');
        try {
            return fs.existsSync(configPath) && fs.statSync(configPath).isDirectory();
        } catch {
            return false;
        }
    }

    async addNeighborVault(vaultPath: string) {
        if (!this.settings.neighborVaults.includes(vaultPath)) {
            this.settings.neighborVaults.push(vaultPath);
            await this.saveSettings();
        }
        await this.ensureBidirectionalLink(vaultPath);
    }

    async ensureBidirectionalLink(remoteVaultPath: string) {
        // Try to add THIS vault to the REMOTE vault's settings
        const currentVaultPath = (this.app.vault.adapter as any).basePath;
        if (!currentVaultPath) return;

        // Determine where the remote plugin settings live
        // Determine where the remote plugin settings live
        // Robust strategy: Iterate over plugins in remote vault to find the one with id "vault-linker"
        let remotePluginDir = null;
        const remotePluginsPath = path.join(remoteVaultPath, '.obsidian', 'plugins');

        if (fs.existsSync(remotePluginsPath)) {
            const pluginDirs = fs.readdirSync(remotePluginsPath, { withFileTypes: true });
            for (const dirent of pluginDirs) {
                if (dirent.isDirectory()) {
                    const manifestPath = path.join(remotePluginsPath, dirent.name, 'manifest.json');
                    if (fs.existsSync(manifestPath)) {
                         try {
                             const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                             if (manifest.id === PLUGIN_ID) {
                                 remotePluginDir = dirent.name;
                                 break;
                             }
                         } catch (e) {
                             // Ignore invalid manifests
                         }
                    }
                }
            }
        }

        if (!remotePluginDir) {
             // Fallback to standard names if scanning failed or folder not found (maybe not installed yet but folder exists?)
            if (fs.existsSync(path.join(remoteVaultPath, '.obsidian', 'plugins', 'vault-linker'))) remotePluginDir = 'vault-linker';
            else if (fs.existsSync(path.join(remoteVaultPath, '.obsidian', 'plugins', 'Vault-Linker'))) remotePluginDir = 'Vault-Linker';
        }

        const remoteDataPath = remotePluginDir ? path.join(remoteVaultPath, '.obsidian', 'plugins', remotePluginDir, 'data.json') : null;

        if (remoteDataPath && fs.existsSync(remoteDataPath)) {
            try {
                const dataContent = fs.readFileSync(remoteDataPath, 'utf-8');
                const data = JSON.parse(dataContent);

                // Initialize if missing
                if (!data.neighborVaults) data.neighborVaults = [];
                if (!data.discoveredVaults) data.discoveredVaults = [];

                let changed = false;

                // 1. Suggest THIS vault
                if (!data.neighborVaults.includes(currentVaultPath) && !data.discoveredVaults.includes(currentVaultPath)) {
                    data.discoveredVaults.push(currentVaultPath);
                    changed = true;
                }

                // 2. Gossip: Suggest my other neighbors to the remote vault
                // "If possible, vault B should display the connections to all the other vaults that vault A has in its options too"
                for (const neighbor of this.settings.neighborVaults) {
                    if (neighbor === remoteVaultPath) continue; // Don't suggest B to B
                    if (!data.neighborVaults.includes(neighbor) && !data.discoveredVaults.includes(neighbor)) {
                        data.discoveredVaults.push(neighbor);
                        changed = true;
                    }
                }

                if (changed) {
                    fs.writeFileSync(remoteDataPath, JSON.stringify(data, null, 2));
                    new Notice(`Updated configuration in ${path.basename(remoteVaultPath)}`);
                }
            } catch (e) {
                console.error(`Failed to update remote vault settings at ${remoteDataPath}`, e);
            }
        } else {
            // Case where the remote vault doesn't have the plugin set up yet or different folder
            // We can optionally try to create it, but that's risky. Stick to modifying existing data.
            console.warn(`Remote vault ${remoteVaultPath} does not seem to have the plugin data.json`);
        }
    }
}
