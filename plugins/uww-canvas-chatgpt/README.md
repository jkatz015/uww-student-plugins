# UW-Whitewater Canvas for ChatGPT desktop

This plugin packages the same Canvas MCP tools as the Claude Desktop plugin for ChatGPT desktop Work with Local selected. It runs on each student's own Windows or Mac computer. Node.js 18 or later is required. Each student uses their own Canvas personal access token.

The distributable plugin is this folder: root `plugin.json` identifies it, root `mcp.json` starts the local Canvas MCP server, and `skills/` contains setup guidance. `.codex-plugin/plugin.json` and `.mcp.json` remain as compatibility files for clients that use the older ChatGPT plugin layout. The repository's `.agents/plugins/marketplace.json` lists this folder as a GitHub marketplace entry. Packaging and listing it in GitHub do not publish it to ChatGPT's universal public Plugins Directory.

## What it does

- Read courses, assignments, instructions, rubrics, due dates, grades, discussions, modules, and course files.
- Download selected course files to a folder you choose.
- Submit assignments and post discussion replies after enabling writes. Every such action still needs a separate on-screen confirmation.
- Show a setup-status report that never prints the token.

The local prompt is titled **Canvas for ChatGPT**. On Windows, the token is stored encrypted with DPAPI for that Windows login. On Mac, it is stored in Keychain. The token is never entered in chat or committed to this repository. This plugin keeps its own token and write opt-in, separate from the Claude plugin.

## Availability to classmates

This GitHub repository is a ChatGPT plugin marketplace source. Registering it on the author's computer does **not** add it to other students' Plugins Directories. There is currently no verified click-only installation path for separate personal ChatGPT accounts from this local marketplace.

If everyone belongs to the **same managed ChatGPT workspace**, a workspace administrator can import the repository through **Admin > Plugins > Add > Import marketplace**. Enter `https://github.com/jkatz015/uww-student-plugins` as the source and leave Path empty. After the import, eligible classmates can open the workspace's Plugins Directory and install **UW-Whitewater Canvas** there. The administrator must make the plugin available to their roles. The plugin is marked Desktop only because it includes a local MCP server. Each classmate still needs Node.js 18 or later installed through [nodejs.org](https://nodejs.org/) and must use **ChatGPT desktop > Work > Local** for the local prompt and encrypted key storage.

For students with **separate personal ChatGPT accounts** who should find the plugin in the public Plugins Directory without a setup command, this local version cannot be published as-is. That requires a hosted HTTPS MCP service, a user authentication flow, and OpenAI's public plugin submission and review. The hosted version would need a different encrypted token store because Windows DPAPI and macOS Keychain run on each student's computer.

After the plugin is available in ChatGPT desktop:

1. In Canvas, open **Account > Settings > Approved Integrations > + New Access Token**, set an expiration date, and copy the token.
2. Ask ChatGPT to “list my Canvas courses.” Paste the token into the **Canvas for ChatGPT** box on your own screen and click Save. Ask again to load your courses.

Do not paste a Canvas token into chat. If the token expires or Canvas rejects it, the saved copy is cleared and the next Canvas request prompts again.

## Limits

This plugin is for ChatGPT desktop Work with Local selected. It has not been tested in the desktop UI yet. Work Cloud and ChatGPT web cannot display this local token prompt. This repository does not provide a hosted service. Linux is not supported by this package because its token storage and on-screen confirmation are implemented for Windows and macOS only.

The plugin connects specifically to `https://uwwtw.instructure.com` and renders dates in `America/Chicago`. Canvas course content returned to ChatGPT is processed as part of the conversation. A Canvas token may have broad account permissions, so revoke it in Canvas when you stop using the plugin.
