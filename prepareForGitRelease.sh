# minor version bump
npm version patch --no-git-tag-version

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
echo "Updated plugin in novel writing folder"

zip -vr vault-linker.zip vault-linker -x "*.DS_Store"

mv vault-linker.zip release.zip

# remove the current_release folder
# rm -rf vault-linker

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

