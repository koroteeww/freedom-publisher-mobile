# Freedom Publisher Mobile ZIP

Contains two Expo React Native versions:

- `freedom-publisher-expo-go/` for Expo Go testing.
- `freedom-publisher-eas-dev/` for EAS cloud APK builds without Android Studio.

# Freedom Publisher Mobile

Mobile publishing assistant for `freedom-clips-ai`.

It does **not** fully automate TikTok / Instagram / YouTube / X publishing. It automates the boring parts around manual publishing:

1. Scans source albums, for example `FreedomClips_EN`, `FreedomClips_HI`, `FreedomClips_FR`, `FreedomClips_TR`.
2. Shows one next video from each album.
3. Builds caption from filename.
4. Copies caption to clipboard.
5. Opens Android Share Sheet for the video.
6. You manually choose TikTok / Instagram / YouTube / X and press Publish.
7. You paste the resulting links back into the app.
8. App updates `publishingLOG/dayN.md` in GitHub.
9. App moves published video to `FreedomClips_Done`.

## Required Samsung albums

Create albums in Samsung Gallery:

```text
FreedomClips_EN
FreedomClips_HI
FreedomClips_FR
FreedomClips_TR
FreedomClips_Done
```

Put videos into language albums.

## GitHub token

For GitHub sync, create a fine-grained personal access token for only your repository.

Recommended permissions:

- Repository: `koroteeww/freedom-clips-ai`
- Contents: Read and write
- Expiration: short, for example 30 or 90 days

Paste token in app Settings.

Security note: this MVP stores token locally with AsyncStorage. That is acceptable for a private personal APK, but do not publish an APK containing your token and do not share it with untrusted people.

## Limitations

- The app opens Android Share Sheet; it does not press Publish for you.
- Some apps may ignore caption from share intent, so the app copies caption to clipboard before sharing.
- Moving video between albums may ask Android/Samsung confirmation.
- Expo Go version is for fast testing.
- EAS build version creates an installable APK without Android Studio.

# EAS development / APK build version

This version is for building an installable APK without Android Studio.

```powershell
cd freedom-publisher-eas-dev
npm install
npx expo install expo-media-library expo-sharing expo-clipboard @react-native-async-storage/async-storage expo-dev-client
npm install js-base64
npm install -g eas-cli
eas login
```

Development build APK:

```powershell
eas build -p android --profile development
npx expo start --dev-client --tunnel
```

Preview APK, recommended for real daily use:

```powershell
eas build -p android --profile preview
```

After build finishes, open the APK link on Samsung and install it.
