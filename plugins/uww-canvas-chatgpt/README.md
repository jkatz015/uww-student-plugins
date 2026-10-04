# UW-Whitewater Canvas for ChatGPT desktop

This plugin packages the same Canvas MCP tools as the Claude Desktop plugin for local Codex use in ChatGPT desktop. It runs on each student's own Windows or Mac computer. Node.js 18 or later is required. Each student uses their own Canvas personal access token.

## What it does

- Read courses, assignments, instructions, rubrics, due dates, grades, discussions, modules, and course files.
- Download selected course files to a folder you choose.
- Submit assignments and post discussion replies after enabling writes. Every such action still needs a separate on-screen confirmation.
- Show a setup-status report that never prints the token.

The local prompt is titled **Canvas for ChatGPT**. On Windows, the token is stored encrypted with DPAPI for that Windows login. On Mac, it is stored in Keychain. The token is never entered in chat or committed to this repository. The token and write opt-in store are shared with the Claude plugin if both are used on the same computer.

## Install

1. Install Node.js 18 or later from [nodejs.org](https://nodejs.org/) or your system's package manager. Fully restart ChatGPT desktop afterward.
2. Add this repository as a plugin marketplace with `codex plugin marketplace add jkatz015/uww-student-plugins` in a local terminal with the Codex CLI. In ChatGPT desktop's Plugins Directory, select **UW-Whitewater Student Plugins** and install **UW-Whitewater Canvas**. You can also run `codex plugin add uww-canvas-chatgpt@uww-student-plugins`. Use Codex locally in the desktop app so the MCP server and on-screen prompts run on your computer.
3. In Canvas, open **Account > Settings > Approved Integrations > + New Access Token**, set an expiration date, and copy the token.
4. Ask ChatGPT to “list my Canvas courses.” Paste the token into the **Canvas for ChatGPT** box on your own screen and click Save. Ask again to load your courses.

Do not paste a Canvas token into chat. If the token expires or Canvas rejects it, the saved copy is cleared and the next Canvas request prompts again.

## Limits

This local plugin is for the local Codex runtime in ChatGPT desktop. It has not been tested in the desktop UI yet. Ordinary cloud ChatGPT conversations and a public Plugins Directory submission require a hosted HTTPS MCP server and a separate OAuth account connection; this repository does not provide that hosted service. Linux is not supported by this package because its token storage and on-screen confirmation are implemented for Windows and macOS only.

The plugin connects specifically to `https://uwwtw.instructure.com` and renders dates in `America/Chicago`. Canvas course content returned to ChatGPT is processed as part of the conversation. A Canvas token may have broad account permissions, so revoke it in Canvas when you stop using the plugin.
