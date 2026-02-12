# minor version bump
npm run build

# create the current_release directory if it does not exist
mkdir -p copy-file-link-hotkey

# make a copy of the main.js, manifest.json, and styles.css files in another folder
cp main.js copy-file-link-hotkey
cp manifest.json copy-file-link-hotkey
cp styles.css copy-file-link-hotkey
# compress the current_release folder into a zip file
# zip -r release.zip current_release

# send to my novel folder
# cp -r copy-file-link-hotkey /Users/caffae/Notes/Novel-Writing/.obsidian/plugins/
cp -r copy-file-link-hotkey "/Users/caffae/Notes/ZettelPublish (Content Creator V2 April 2025)/.obsidian/plugins/"
# echo "Updated plugin in novel writing and zettelpublish folders"
echo "Updated plugin in zettelpublish folders"

