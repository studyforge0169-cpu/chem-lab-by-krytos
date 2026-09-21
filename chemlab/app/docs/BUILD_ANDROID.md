# Putting ChemLab on an Android phone

Two ways, and the first one is the one to try before you build anything.

---

## A. Install it as it is (no Android Studio, no APK)

The app is a static bundle plus a service worker. Any HTTPS host will do:

```bash
cd chemlab/app
npm install
npm run build          # sync the data, draw the icons, vite build, prune, generate sw.js
npx serve dist         # …or any static host you already trust, or GitHub Pages
```

Open it in **Chrome on the phone**, then the ⋮ menu → **Add to Home screen**. It installs with the
ChemLab icon, opens in its own window with no browser bar, and after the first load it never needs
the network again: the 1.27 MB of data files are in the cache and the worker refuses to go anywhere
else. `npm run serve` on this machine also works if the phone is on the same network
(`http://<your-ip>:8080`), but a plain `http://` origin will not let the service worker register —
that is a browser rule, so use any HTTPS host for the install.

To check it really is offline: put the phone in airplane mode after opening it once, then reload.
Everything on screen should still be there, and the **Data** tab's offline card should read
*“offline: this whole lab is on the device”*.

---

## B. Wrap it in an APK with Capacitor

For when you want it in the Play Store, or want to hand someone an `.apk`.

### What you need

- Node 20 or newer
- JDK 17 and Android Studio (whatever SDK/build-tools it offers to install is fine)
- `npm run check` passing in `chemlab/app` — it runs `tsc`, the 276 tests and the build

### 1. Build the web bundle

```bash
cd chemlab/app
npm run build
du -sh dist            # ~2.6 MB: 374 KB JS (122 KB gz), 19 KB CSS, 1.27 MB data, icons, sw.js
```

`dist/` is the whole app. `npm run sync` (run by `prebuild`) copies
`chemlab/data/chemlab.json.gz`, `combinations.json.gz` and writes `manifest.json` with the sha256,
row counts and a `build_id`; `scripts/prune-dist.mjs` then drops the uncompressed JSON copies that
`public/data` keeps for convenience, because the loader asks for the `.gz` files and only falls
back; `scripts/gen-sw.mjs` rewrites `dist/sw.js` with the file list that is actually in `dist` and
sets the cache name to the `build_id`, so a new build cannot serve a stale shell.

### 2. Add Capacitor

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init "ChemLab" ai.arena.chemlab --web-dir dist
npx cap add android
```

`capacitor.config.ts`, if you want to be explicit (this is all the app needs):

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.arena.chemlab",
  appName: "ChemLab",
  webDir: "dist",
  // the bundle is self-contained and the WebView serves it from https://localhost,
  // so there is nothing to proxy and no cleartext traffic to allow
  server: { androidScheme: "https" },
};

export default config;
```

Then, every time you change the data or the code:

```bash
npm run build && npx cap sync android
```

### 3. Icons

The icon set is generated from the app's own palette, so Android gets the same nine tiles as the
web manifest (`scripts/make-icons.mjs` draws them; `npm run icons` re-draws them).

```bash
mkdir -p assets
cp public/icons/icon-512.png assets/AppIcon.png
cp public/icons/icon-512.png assets/splashIcon.png
npx @capacitor/assets generate --android --iconBackgroundColor "#0b0f16" --splashBackgroundColor "#0b0f16"
```

If that plugin's name or flags differ in the version you get, the manual version is six lines and
does exactly the same thing — the maskable icon is already built for the safe zone:

```bash
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  cp public/icons/icon-192.png android/app/src/main/res/mipmap-$d/ic_launcher.png
  cp public/icons/icon-192.png android/app/src/main/res/mipmap-$d/ic_launcher_round.png
done
cp public/icons/icon-maskable-512.png android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png
```

### 4. Build and install

```bash
cd android
./gradlew assembleDebug
ls -la app/build/outputs/apk/debug/app-debug.apk     # this is the thing to send to a phone
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For a Play Store upload, bump `versionCode`/`versionName` in `android/app/build.gradle`, then:

```bash
keytool -genkey -v -keystore chemlab.keystore -alias chemlab -keyalg RSA -keysize 2048 -validity 10000
cd android && ./gradlew bundleRelease     # app/build/outputs/bundle/release/app-release.aab
```

Sign the AAB with Play App Signing, or with your keystore:
`apksigner sign --ks ../chemlab.keystore --out signed.aab app-release.aab`.

### 5. Permissions and size

The app needs no permissions. If you would rather the manifest say so explicitly, delete the
`android.permission.INTERNET` line from `android/app/src/main/AndroidManifest.xml` — Capacitor adds
it, and ChemLab does not use it: the data is read from the assets the APK carries, and the service
worker is a warm cache inside an installed app, not a network path. (Leave it in if you want the
PubChem links on a substance's sheet to open in a browser tab: those are `target=_blank` links,
which the WebView hands to the system browser either way.)

The APK ends up around 4 MB: ~2.6 MB of it is this app, the rest is the Capacitor shell. There is
no second copy of the data in there, which is why `prune-dist.mjs` matters before `cap sync`.

### 6. Updating the science

The data and the app are allowed to disagree about nothing, so the update path is one command:

```bash
cd chemlab && python3 scripts/build_warehouse.py && python3 scripts/validate_warehouse.py
cd app && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
```

`npm run build` fails loudly if a shipped file is missing (the loader in `src/data/load.ts` asks for
`chemlab.json.gz` by name); the test suite asserts the row counts (118 / 582 / 424 / 9 410), so a
build that quietly lost a table is caught before it reaches a phone. Inside the app, the **Data** tab
shows the `build_id` and the date the data was generated, and any notebook entry you saved against
an older build says so next to its verdict.

---

## iOS, if you ever have a Mac

`npx cap add ios && npx cap sync ios && open ios/App/App.xcworkspace`. Nothing in the app is
Android-specific; the same `dist/` goes in, and the service worker behaves the same in WKWebView.
