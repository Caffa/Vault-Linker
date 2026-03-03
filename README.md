# Vault Linker

![showcase](media/showcase.gif)

Connect your Obsidian vaults together. Link to files and embed content from other vaults as if they were part of your current vault.

## The Problem

If you keep your notes in more than one Obsidian vault, you've probably run into this: you write a link to a note in another vault, but it doesn't work. It just shows up as an unresolved link—useless.

**The issue:** Your vaults are separate. Links between them don't function because Obsidian only looks for files inside the current vault.

## What Vault Linker Does

It lets you link to notes in your other vaults and actually make them work.

- `[[Other Vault/Note]]` — click it, and that note opens in its own vault
- `![[Other Vault/Note]]` — embed content from another vault right in your note
- Also works with block references (`#^block-id`) and headings (`#Heading Name`)

## Who This Is For

- **Multiple vault users**: You split your notes into different vaults (diary, work, Zettelkasten, projects, etc.)
- **Cross-referencers**: You want to reference notes from one vault in another without copy-pasting
- **Separate but connected**: You like keeping vaults separate but still need them to link together

## How It Works

Vault Linker indexes all files in your connected vaults (stored locally in `.obsidian/plugins/vault-linker/index.json`). When you open a note, it looks at any unresolved links—if the target exists in another vault, it marks that link as cross-vault. When you click, it uses the `obsidian://open` URI to launch the file in the correct vault.

**Setup is simple:**

1. Install Vault Linker in each vault you want to connect
2. In settings, connect your vaults (scan a parent folder or add paths manually)
3. Write normal links—the plugin handles the rest automatically

## Technical Details

- **Desktop Only**: Requires file system access to read indices from other vaults
- **Storage**: Each vault stores its index at `.obsidian/plugins/vault-linker/index.json`
- **Performance**: Uses multiple caches (negative cache, lookup cache, normalization cache) for fast lookups
- **Automatic Updates**: Indices regenerate on file create/delete/rename (debounced 5 seconds)

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Caffa/vault-linker/releases)
2. Place them in `<Vault>/.obsidian/plugins/vault-linker/`
3. Reload Obsidian and enable the plugin in **Settings → Community plugins → Vault Linker**

## Setup

### 1. Configure Vault Connections

Open **Settings → Vault Linker** and set your connections:

**Option A: Auto-Discover Multiple Vaults**

1. Set "Parent folder for vaults" to the folder containing your vaults
2. Click **Scan for Vaults** to find all vaults in that folder
3. Toggle on the vaults you want to connect

**Option B: Add Vaults Individually**

1. Click **Browse & Add** under "Add specific vault"
2. Select a vault folder that has an `.obsidian` folder

### 2. Customize Appearance (Optional)

- Set **Link color** for cross-vault links (default: green)
- Set **Embed background color** for remote embeds (default: light purple)

## Usage

### Linking to Another Vault

Just write a link normally. If the file exists in a connected vault, Vault Linker makes it work:

```markdown
See [[Project A/Research]] for more details.
```

Click the link—the note opens in the "Project A" vault.

### Embedding Content

Bring content from another vault into your note:

```markdown
// Entire note
![[Project A/Research]]

// Specific section by heading
![[Project A/Research#Methodology]]

// Specific block by ID
![[Project A/Research#^my-block-id]]
```

The embedded content renders with full markdown. Click it to open the source file in its vault.

### Refreshing Indices

If you create or rename many files in other vaults, manually refresh:

- Use the command palette: **Refresh Cross-Vault Indices**
- Or reload the current vault to trigger an index rebuild

## Technical Details

- **Desktop Only**: Requires file system access to read indices from other vaults
- **Storage**: Each vault stores its index at `.obsidian/plugins/vault-linker/index.json`
- **Performance**: Uses multiple caches (negative cache, lookup cache, normalization cache) for fast lookups
- **Automatic Updates**: Indices regenerate on file create/delete/rename (debounced 5 seconds)

## Requirements

- Obsidian 1.7.7 or later
- Desktop app (not mobile)
- Other vaults must have Vault Linker installed and enabled

## Limitations

- Links to images in other vaults are not yet supported (use `obsidian://open` URIs manually)
- Only markdown files are indexed
- All vaults must be on the same local filesystem

## Troubleshooting

**Links aren't resolving to other vaults:**

- Verify Vault Linker is installed and enabled in all target vaults
- Check **Settings → Vault Linker → Vault Connections** to ensure vaults are connected (toggle = on)
- Run **Refresh Cross-Vault Indices** from the command palette

**Embed shows no content:**

- Ensure the target file exists in a connected vault
- Check console for errors (Developer Tools → Console)
- Verify the file path is correct (case-sensitive on some systems)

**Can't find other vaults:**

- Set the correct parent folder path in settings
- Click **Scan for Vaults** to rediscover
- Use **Browse & Add** to manually add vault paths

## Contributing

This plugin is open source. Issues and pull requests are welcome on [GitHub](https://github.com/Caffa/vault-linker).

## Support

If you find Vault Linker useful, consider [supporting the project](https://ko-fi.com/pamelawang_mwahacookie).

## License

MIT
