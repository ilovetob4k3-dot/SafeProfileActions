# SafeProfileActions

`SafeProfileActions` is a small Revenge/Kettu/Vendetta-compatible mobile plugin that visually removes selected user profile action buttons from Discord profile sheets to reduce accidental taps.

Targeted profile buttons:

- `Add Friend` pill button
- `Message` circular button
- `Call` circular button

Targeted Discord build:

- `331.14 (5704) - googleRelease`

## What It Does

Version `0.1` hides profile action buttons by removing them from the rendered UI only.

Default behavior:

- Hide Add Friend: `true`
- Hide Message: `true`
- Hide Call: `false`
- Debug mode: `false`

## Safety Note

This plugin performs visual removal only.

It does not:

- send friend requests
- cancel friend requests
- open or patch network APIs
- access tokens, cookies, auth, or session data
- read messages
- modify relationships
- auto-send or auto-cancel any action

## Installation Notes

Load the plugin through your client using this repository's `manifest.json`.

Repo layout:

- `manifest.json`
- `index.js`
- `src/index.ts`
- `src/settings.tsx`

For GitHub Pages / unproxied installs, the loader should fetch these root files directly:

- `https://ilovetob4k3-dot.github.io/SafeProfileActions/manifest.json`
- `https://ilovetob4k3-dot.github.io/SafeProfileActions/index.js`

`manifest.json` includes a root `hash` field and points `main` to the standalone `index.js` entry.
Update the manifest hash whenever `index.js` changes.

## Settings

- `Hide Add Friend`: hides the large Add Friend pill on profile sheets.
- `Hide Message`: hides the profile message button.
- `Hide Call`: optionally hides the profile phone/call button.
- `Debug mode`: logs sanitized button metadata such as prop keys, accessibility labels, visible labels, and icon/source names when available.

The install entrypoint is the bundled root `index.js`. The files in `src/` remain as development/source reference.

Debug logging never includes:

- user IDs
- usernames
- bios
- messages
- server names
- tokens
- cookies
- auth or session data

## Compatibility Notes

The plugin follows the same `@vendetta/*` plugin structure and storage/settings pattern used by the confirmed-compatible local Revenge reference plugin:

- `references/shipwr3ckd-revengeplugin/plugins/HideBlockedAndIgnoredMessages`

UI patch targets were chosen to match the known profile/contact component family used by similar profile button plugins:

- `UserProfileActions`
- `SimplifiedUserProfileContactButtons`
- `UserProfileContactButtons`

## Known Limitations

- Discord may rename or restructure these components in future builds.
- Button detection prefers labels and accessibility metadata first, then known icon/source hints.
- The safest label matching is tuned for the targeted build and English button labels; icon hints are only a secondary fallback.
- If Discord changes the component shape enough that those signals disappear, the plugin will fail quietly instead of forcing risky fallback behavior.
- Confirmation mode is not included in `v0.1`.
