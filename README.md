# UW-Whitewater student plugins for Claude and ChatGPT desktop

This repository has two Canvas plugins for UW-Whitewater students. Both connect to `https://uwwtw.instructure.com`, use each student's own Canvas token, and provide the same Canvas tools. Choose the plugin for your desktop app:

| Desktop app | Plugin | Setup |
| --- | --- | --- |
| Claude Desktop | `uww-canvas` | Follow the Claude instructions below. |
| ChatGPT desktop, Work with Local selected | `uww-canvas-chatgpt` | [ChatGPT desktop setup](plugins/uww-canvas-chatgpt/README.md). |

Both versions prompt for the token on your own computer and save it with Windows DPAPI or macOS Keychain. Each plugin has its own saved token and write opt-in. Canvas information returned to either app is processed in that conversation. Neither plugin is an official Canvas or UW-Whitewater product.

## ChatGPT desktop setup

Add this GitHub web address as a custom plugin marketplace in ChatGPT desktop:

**https://github.com/jkatz015/uww-student-plugins**

Choose **UW-Whitewater Canvas** (`uww-canvas-chatgpt`) and follow the [ChatGPT setup instructions](plugins/uww-canvas-chatgpt/README.md). GitHub installation and API-key entry have been confirmed in Jonathan's Windows ChatGPT desktop setup. Each person adds the marketplace in their own account.

The ChatGPT plugin includes reading, downloading, submitting assignments, and posting replies. Its tools are allowed by default in the ChatGPT package; submissions and posts still require the existing on-screen confirmations. A stricter host policy can override the package default.

## Claude Desktop setup

Connects Claude Desktop to your UW-Whitewater Canvas account. Ask Claude about your courses, upcoming due dates, grades, assignment instructions, modules, discussions and course files.

- Your Canvas token is entered in a pop-up box on your own screen and saved encrypted on your computer. It never goes through a chat.
- Read-only by default. If you turn on submitting and posting, every submission or post still opens a box on your screen, and nothing goes to Canvas unless you click Yes.
- When Claude reads your Canvas information to answer you, that information is sent to Claude, like anything else you share in a chat.

### Install in Claude (one time, about 5 minutes)

1. Install Node.js. On Windows, open PowerShell and run:
   `winget install OpenJS.NodeJS.LTS`
   Then close and reopen PowerShell and run `node -v`; it should print a version number. If winget is blocked (some school or work laptops) or you are on a Mac, download the LTS installer from https://nodejs.org instead.
2. In Claude Desktop, open Customize > Plugins > Add marketplace, and enter: `jkatz015/uww-student-plugins`
3. Find **uww-canvas** in the list and click Install. Then fully quit Claude (right-click its icon by the clock > Quit) and reopen it. Claude only finds Node.js after a full restart, so do not skip this.
4. In Canvas, go to Account > Settings > Approved Integrations > + New Access Token. Give it an expiration date (end of semester is good) and copy the token.
5. Ask Claude: "list my Canvas courses". A box titled "Canvas for Claude" pops up. Click in it, press Ctrl+V, check that it says "Token entered: N characters", and click Save. Ask again.

Never paste your token into the chat.

### Getting updates in Claude

On the Plugins page, open this marketplace and turn on **Sync automatically**, or click **Check for updates** now and then.

### When your Claude plugin token expires

Canvas will reject it and the plugin will forget it. Create a new token in Canvas, ask Claude anything about Canvas, and paste the new token into the pop-up box.

### Having trouble in Claude?

Ask Claude for your "Canvas setup status" and send the result to Jonathan. It shows what is going on without revealing your token.
