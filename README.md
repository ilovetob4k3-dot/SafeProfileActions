# SafeProfileActions

`SafeProfileActions` is a small Revenge/Vendetta-compatible plugin with two narrow behaviors:

- silently block `Add Friend` by patching `addRelationship`
- confirm every `addReaction` call before it is sent

Default behavior:

- `Add Friend` is blocked.
- The blocked `addRelationship` call returns `Promise.resolve(null)`.
- No Add Friend toast is shown unless enabled in settings.
- Reactions require two confirmations by default.

## Safety Note

This plugin only patches:

- `addRelationship`
- `addReaction`

It does not:

- patch `React.createElement`
- hide buttons or scan broad UI trees
- branch on burst or Super reactions
- patch `fetch`, `XMLHttpRequest`, or `WebSocket`
- access tokens, cookies, auth, or session data
- read message content

## Installation Notes

Load the plugin through your client using this repository's `manifest.json`.

For GitHub Pages / unproxied installs, the loader should fetch these root files directly:

- `https://ilovetob4k3-dot.github.io/SafeProfileActions/manifest.json`
- `https://ilovetob4k3-dot.github.io/SafeProfileActions/index.js`

`manifest.json` points `main` to the standalone `index.js` entry and keeps the install URL unchanged.

## Settings

- `Show Add Friend Block Toast`: default `false`
- `Confirm Reactions`: default `true`
- `Double Confirm Reactions`: default `true`
- `Show Emoji In Prompt`: default `false`
