# SafeProfileActions

`SafeProfileActions` is a small Revenge/Vendetta-compatible plugin that blocks the profile `Add Friend` action by patching `addRelationship`.

Default behavior:

- `Add Friend` is blocked.
- The original `addRelationship` call is not invoked when blocked.
- The blocked call returns `Promise.resolve(null)`.
- No toast is shown unless enabled in settings.

## Safety Note

This plugin only patches `addRelationship`.

It does not:

- patch `React.createElement`
- learn press sources
- hide learned buttons
- trace components
- patch `fetch`, `XMLHttpRequest`, or `WebSocket`
- access tokens, cookies, auth, or session data
- read message content
- log usernames, user IDs, bios, server names, or messages

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

- `Show block toast`: default `false`. When enabled, blocked Add Friend attempts show `oops lol`.
