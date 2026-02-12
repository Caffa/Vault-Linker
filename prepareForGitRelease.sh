# minor version bump
npm version patch --no-git-tag-version

# create the current_release directory if it does not exist
mkdir -p copy-file-link-hotkey

# make a copy of the main.js, manifest.json, and styles.css files in another folder
cp main.js copy-file-link-hotkey
cp manifest.json copy-file-link-hotkey
cp styles.css copy-file-link-hotkey
# compress the current_release folder into a zip file
# zip -r release.zip current_release

# send to my novel folder
cp -r copy-file-link-hotkey /Users/caffae/Notes/Novel-Writing/.obsidian/plugins/
echo "Updated plugin in novel writing folder"

zip -vr copy-file-link-hotkey.zip copy-file-link-hotkey -x "*.DS_Store"

mv copy-file-link-hotkey.zip release.zip

# remove the current_release folder
# rm -rf copy-file-link-hotkey

# Get the new version and create a tag without 'v' prefix
VERSION=$(node -p "require('./package.json').version")
git add -A
LASTCOMMIT=$(git log -1 --pretty=%B)
# git commit -m "Prepare for Git Release. Bump version to $VERSION"
git commit -m "Release version $VERSION, $LASTCOMMIT"
git tag $VERSION
# git push origin main
echo "Pushing to main tag... "
# echo "git push origin tag $VERSION"
git push origin tag $VERSION
echo "Creating a new release... "
# Create a new release on GitHub with the zip file and the last commit message
gh release create $VERSION release.zip main.js styles.css manifest.json --title "Release $VERSION" --notes "$LASTCOMMIT"

