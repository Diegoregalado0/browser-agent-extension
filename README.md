# Browser Agent

Version 1.0.0

A browser that runs your own AI browsing agent.

Open the side panel, say what you want done, and the agent does it in your tabs: it opens
pages, clicks, types, fills in forms, and tells you when it is finished. It works with your
own API key from Anthropic, OpenAI, Google Gemini, or Mistral, or with a local model through
Ollama. There is no account and no server in between.

It is a regular Chrome extension. It does not use Chrome's debugger, so there is no
"started debugging this browser" banner.

## Install

Works in Chrome on Mac, Windows, and Linux.

1. Get the code and build the extension (needs [Node.js](https://nodejs.org) 22 or newer):

   ```sh
   git clone -b no-debugger https://github.com/Diegoregalado0/browser-agent-extension.git
   cd browser-agent-extension
   npm install
   npm run build
   ```

2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and select the `dist/extension` folder.
3. Click the Browser Agent icon in the toolbar (or press Cmd+Shift+Y, Ctrl+Shift+Y on
   Windows and Linux) and add your API key when asked.

## Use it

- Type a task, for example "find a well-reviewed lasagna recipe and open it" or "check my
  email for the verification code and enter it here". Press Enter.
- The agent works in the tabs of the window you opened it in, and marks the one it is using
  with an "Agent" tab group. It never takes over tabs you opened.
- **Menu** (top right): settings on top, your past sessions below. Reopen a session to pick
  up where you left off.
- **Ghost mode** (the ghost button): the session is not saved. It is always on in incognito
  windows.
- Press **Stop** at any time. Closing the panel also stops the task.

The agent clicks and types by sending events to the page. A few sites ignore those; when
that happens the agent tries the element's other controls, and you can finish the step
yourself. It cannot use the browser's own menus, extension popups, or chrome:// pages.

## Your API key

The key stays in your browser profile, is never synced, and is sent only to the provider it
belongs to. That provider bills you for what the agent uses. To keep costs in check, the
agent has limits you can change in Settings: 20 model requests and 60 browser actions per
minute, 2 million tokens per task, and 10 million per day.

## Safety

- By default a small model checks each action against what you asked for and watches pages
  for text that tries to take over the agent. If something looks wrong, it asks you.
- On banks, payment sites, password managers, and account security pages, it always asks
  before clicking or typing. It never types into a password field without asking.
- It can only open regular web pages.

## Publish to the Chrome Web Store

1. Build the package: `npm run build` creates `dist/browser-agent-extension.zip`. Raise
   `version` in `package.json` for every update.
2. Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (one-time US$5 fee), and verify your contact email.
3. Click **Add new item** and upload the zip.
4. **Store listing**: name, description, category, the 128 px icon, and at least one
   1280x800 screenshot.
5. **Privacy**: state the single purpose ("an AI agent that carries out tasks in the user's
   tabs with their own API key"), explain each permission (`scripting`, `tabs`, `tabGroups`,
   `sidePanel`, `storage`, and access to all sites, which the agent needs to read and act on
   the pages you send it to), declare that page content is sent only to the provider the
   user chooses, and link a privacy policy.
6. **Distribution**: free, and public or unlisted.
7. **Test instructions**: reviewers need a key to try it. Give them a key with a low spending
   limit, or explain that they should paste their own.
8. Click **Submit for review**. You can choose to publish manually after approval (within
   30 days).

## For developers

```sh
npm run check    # syntax check
npm run build    # build dist/extension and the store zip
```

`src/` holds the agent loop, tools, model providers, and safety checks. `extension/` has the
side panel entry point, storage, and the page transport (`chrome.scripting` and
`chrome.tabs`). `ui/` is the panel.
