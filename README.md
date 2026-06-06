# SafeProfileActions

`SafeProfileActions` is a small Revenge/Vendetta-compatible plugin with three narrow behaviors:

- optionally block `Add Friend` by patching `addRelationship`
- optionally double-confirm every `addReaction` call before it is sent
- optionally suppress typing updates by patching `startTyping` and `stopTyping`

Default behavior:

- `Block Add Friends` is enabled.
- The blocked `addRelationship` call returns `Promise.resolve(null)`.
- No Add Friend toast is shown unless enabled in settings.
- `Confirm React` is enabled and keeps the existing two-step prompt flow.
- `Hide Typing Indicator` is disabled.

## Settings

- `Block Add Friends`: default `true`
- `Show Add Friend Block Toast`: default `false`
- `Confirm React`: default `true`
- `Show Emoji In Prompt`: default `false`
- `Hide Typing Indicator`: default `false`

The old `confirmReactions` and `doubleConfirmReactions` keys are migrated into `confirmReact` and then ignored.

## Safety Note

This plugin only patches:

- `addRelationship`
- `addReaction`
- `startTyping`
- `stopTyping`

It does not:

- patch `React.createElement`
- branch on burst or Super reactions
- patch `fetch`, `XMLHttpRequest`, or `WebSocket`
- access tokens, cookies, auth, or session data
- read message content
- read messages, scrape, mass-automate, or perform selfbot actions

## Calls

Hide Call Buttons was not added in this repo revision because no `Hide Call Buttons` source file or upstream link was present in the repo/context to adapt safely. The Calls section in settings is a placeholder note only.

## Installation Notes

Load the plugin through your client using this repository's `manifest.json`.

For GitHub Pages / unproxied installs, the loader should fetch these root files directly:

- `https://ilovetob4k3-dot.github.io/SafeProfileActions/manifest.json`
- `https://ilovetob4k3-dot.github.io/SafeProfileActions/index.js`

`manifest.json` points `main` to the standalone `index.js` entry and keeps the install URL unchanged.
