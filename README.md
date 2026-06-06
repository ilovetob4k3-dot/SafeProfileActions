# SafeProfileActions

`SafeProfileActions` is a small Revenge/Vendetta-compatible plugin with four narrow behaviors:

- optionally block `Add Friend` by patching `addRelationship`
- optionally double-confirm every `addReaction` call before it is sent
- optionally suppress typing updates by patching `startTyping` and `stopTyping`
- optionally hide specific call buttons in user profiles, DMs, and voice chat

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
- `Hide profile voice call button`: default `true`
- `Hide profile video call button`: default `true`
- `Hide DM voice call button`: default `false`
- `Hide DM video call button`: default `false`
- `Hide VC video button`: default `false`

The old `confirmReactions` and `doubleConfirmReactions` keys are migrated into `confirmReact` and then ignored.

## Safety Note

This plugin only patches:

- `addRelationship`
- `addReaction`
- `startTyping`
- `stopTyping`
- `UserProfileActions.default`
- `SimplifiedUserProfileContactButtons.default` or `UserProfileContactButtons.default`
- `PrivateChannelButtons.type`
- `ChannelButtons.ChannelButtons`
- `VideoButton.default`

It does not:

- patch `React.createElement`
- branch on burst or Super reactions
- patch `fetch`, `XMLHttpRequest`, or `WebSocket`
- access tokens, cookies, auth, or session data
- read message content
- read messages, scrape, mass-automate, or perform selfbot actions

## Attribution

Hide Call Buttons behavior in this repo is adapted from `janisslsm/vdplugins`:

- Repo: `https://github.com/janisslsm/vdplugins`
- Plugin: `https://github.com/janisslsm/vdplugins/tree/master/plugins/HideCallButtons`
- Original plugin author: John (`780819226839220265`)

The upstream repository license is BSD-3-Clause. The required notice is reproduced below for the adapted Hide Call Buttons portion:

> BSD 3-Clause License
>
> Copyright (c) 2024 janisslsm
> Copyright (c) 2022 redstonekasi
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice, this
>    list of conditions and the following disclaimer.
>
> 2. Redistributions in binary form must reproduce the above copyright notice,
>    this list of conditions and the following disclaimer in the documentation
>    and/or other materials provided with the distribution.
>
> 3. Neither the name of the copyright holder nor the names of its
>    contributors may be used to endorse or promote products derived from
>    this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
> DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
> FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
> DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
> SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
> CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
> OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
> OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Installation Notes

Load the plugin through your client using this repository's `manifest.json`.

For GitHub Pages / unproxied installs, the loader should fetch these root files directly:

- `https://ilovetob4k3-dot.github.io/SafeProfileActions/manifest.json`
- `https://ilovetob4k3-dot.github.io/SafeProfileActions/index.js`

`manifest.json` points `main` to the standalone `index.js` entry and keeps the install URL unchanged.
