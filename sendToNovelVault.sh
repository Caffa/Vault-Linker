# minor version bump
npm run build

# create the current_release directory if it does not exist
mkdir -p vault-linker

# make a copy of the main.js, manifest.json, and styles.css files in another folder
cp main.js vault-linker
cp manifest.json vault-linker
cp styles.css vault-linker
# compress the current_release folder into a zip file
# zip -r release.zip current_release

# send to my novel folder
cp -r vault-linker /Users/caffae/Notes/Novel-Writing/.obsidian/plugins/
cp -r vault-linker "/Users/caffae/Notes/ZettelPublish (Content Creator V2 April 2025)/.obsidian/plugins/"
cp -r vault-linker "/Users/caffae/Notes/Journal/.obsidian/plugins/"
echo "Updated plugin in novel writing and zettelpublish folders and journal folders"
# echo "Updated plugin in zettelpublish folders"

