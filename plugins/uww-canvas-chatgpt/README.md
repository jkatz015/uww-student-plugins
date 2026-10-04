# UW-Whitewater Canvas for ChatGPT desktop

Connect ChatGPT desktop to your UW-Whitewater Canvas account using your own Canvas API key (personal access token). The plugin runs on your Windows or Mac computer. It includes course lookups, file downloads, assignment submissions, and discussion replies.

## Install from GitHub

1. Install Node.js using the LTS installer from [nodejs.org](https://nodejs.org/) if it is not already installed. Then fully quit and reopen ChatGPT desktop so it can find Node.js.
2. In ChatGPT desktop's Plugins area, use the option to add a custom plugin marketplace from GitHub and enter this repository web address:

   **https://github.com/jkatz015/uww-student-plugins**

3. Select **UW-Whitewater Canvas** (`uww-canvas-chatgpt`) from **UW-Whitewater Student Plugins** and install it.
4. Start a new chat in **Work > Local** so the plugin runs on your computer.

Jonathan has confirmed GitHub installation and API-key entry in Windows ChatGPT desktop. These steps describe that setup; menu labels and available plugin controls can vary by app version. Each person adds the GitHub marketplace in their own account. Classmates do not need a shared ChatGPT workspace or a WSL command for this installation path.

## Connect Canvas

1. In Canvas, open **Account > Settings > Approved Integrations > + New Access Token**. Set an expiration date and copy the token.
2. Ask ChatGPT: **“List my Canvas courses.”** A box titled **Canvas for ChatGPT** opens on your screen.
3. On Windows, click **Paste from clipboard**, check for **“Token entered: N characters”**, and click **Save**. On Mac, paste into the token field and click **Save**.
4. Ask **“List my Canvas courses”** again after saving.

Enter the token in the local box, never in chat. Windows stores it encrypted for your Windows login using DPAPI; Mac uses Keychain. The ChatGPT plugin has its own saved token, separate from the Claude plugin. If Canvas returns an authentication error (401), the plugin clears the saved token and prompts again on the next request.

## What you can do

| Task | Example request |
| --- | --- |
| Courses | “List my Canvas courses.” |
| Assignments and deadlines | “What is due in the next two weeks?” |
| Instructions and rubrics | “Show the instructions and rubric for this assignment.” |
| Grades | “Show my grades for this course.” |
| Discussions and announcements | “Show this week's discussion prompt and replies.” |
| Modules and files | “List the downloadable readings in this course.” |
| One file | “Download this reading to this folder: …” |
| Course files | “Show a download plan for this course's module files, then save them to this folder: …” |
| Assignment submission | “Submit this file to this assignment.” |
| Discussion reply | “Post this reply to this discussion.” |
| Connection diagnostics | “Show my Canvas setup status.” |

Downloads save files to a folder you choose on your computer. They do not change Canvas. Existing files are skipped unless you explicitly request replacement. Bulk downloading finds files listed in course modules; it does not export every page, external link, or attachment in the course. ChatGPT should show the bulk-download plan before saving files.

## Permissions and confirmations

Version **0.1.6** allows all 13 Canvas tools by default at the ChatGPT MCP layer, including downloads, submissions, and discussion replies. Download tools remain correctly marked as writing local files.

The existing Canvas confirmation behavior is preserved:

- The first submission or discussion post asks whether to turn submitting/posting on.
- Every submission or post then shows its own confirmation box with the action details. Nothing is submitted or posted unless you click **Yes**.
- After enabling submitting/posting, later actions require the individual confirmation only. **No**, **Cancel**, or a timeout stops the action.

ChatGPT should show the intended content and destination in chat before calling a submission or posting tool. A stricter ChatGPT host policy can still override the package's permission default.

## Updates and troubleshooting

After updating the GitHub marketplace, fully quit and reopen ChatGPT desktop and start a new chat. Ask for **“Canvas setup status”** to check the running connector version. Package 0.1.6 contains connector version `1.4.6-chatgpt`.

- **“MCP tool call requires approval, but approval policy is never”:** ChatGPT blocked the call before the plugin ran. Update to 0.1.6 and start a new chat. If it persists, send Jonathan the exact error and setup-status report so the host policy can be checked. Replacing the Canvas token does not fix this error.
- **No Canvas tools:** check that the plugin is installed and enabled, Node.js is installed, and the chat uses local execution.
- **No token box:** check behind other windows and on the taskbar. Ask for setup status before retrying.
- **Token cannot be pasted:** on Windows use **Paste from clipboard** and check the character count before saving.
- **Canvas denies access (403):** the connected account cannot access that resource. This differs from ChatGPT blocking the tool.

To change accounts, fully quit ChatGPT first. On Windows, remove `token.dpapi` from the `.canvas-chatgpt` folder in your user folder. On Mac, remove the `uww-canvas-chatgpt` item from Keychain Access. Reopen ChatGPT and connect again. To require the enable-submissions prompt again, remove `allow-write` from `.canvas-chatgpt`.

This package's local prompts and encrypted storage support Windows and macOS. It does not provide a hosted service for web or cloud execution. Dates use Central time. Canvas information returned to ChatGPT becomes part of the conversation. This is not an official Canvas or UW-Whitewater product.

## Maintainer notes

The ChatGPT package uses the supported `.codex-plugin/plugin.json` and `.mcp.json` layout. `.mcp.json` declares `default_tools_approval_mode: "approve"` for this Canvas server. The portable Agent Plugins `mcp.json` schema does not accept this host-specific approval field, so this ChatGPT package uses the compatibility layout intentionally. The repository's `.agents/plugins/marketplace.json` points to this folder.

If a user explicitly wants all Canvas tools allowed and needs a local override, the supported user-config setting is:

```toml
[plugins."uww-canvas-chatgpt@uww-student-plugins".mcp_servers.uww-canvas]
default_tools_approval_mode = "approve"
```

This setting belongs to that person's ChatGPT desktop configuration. A repository push does not edit their local configuration. Do not change global approval policy or label downloads as read-only to fix a host permission error.

Reference: [OpenAI plugin packaging and MCP configuration](https://developers.openai.com/plugins/build/plugins).
