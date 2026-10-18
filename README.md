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

## Optional: Canvas in Claude on your phone (web connector)

**Skip this section unless you want it.** Nothing above changes, and the desktop plugin keeps working exactly the same whether or not you set this up.

The desktop plugin only works in Claude Desktop on your own computer. The web connector is your own private copy running online, so you can ask Claude about Canvas from your phone, in voice mode, or on claude.ai in any browser. Each person runs their own copy with their own Canvas token. Jonathan does not host it and never sees your token.

**What it can do:** read your courses, due dates, grades, assignment instructions, modules, discussions and announcements.
**What it cannot do:** submit assignments, post replies or download files. Those stay in the desktop plugin, where every action needs a click on your own screen.

**Cost:** it runs on Railway, which needs a paid Hobby plan. With sleep turned on (step 7), a server this small uses very little.

### Set it up (one time, about 10 minutes)

1. **Make a Canvas token for it.** In Canvas, go to Account > Settings > Approved Integrations > + New Access Token. Give it an expiration date (end of semester is good) and copy it. Use a new token rather than your desktop one, so you can turn either off on its own.
2. **Deploy your copy.** Click this button, sign in to Railway, paste your token into `CANVAS_TOKEN`, leave everything else as it is, and click Deploy:

   [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/TEMPLATE_CODE?utm_medium=integration&utm_source=button&utm_campaign=uww-canvas)

3. **Copy your connector address.** When the deploy finishes, open the service, go to Settings > Networking, and copy the public address. It looks like `https://something.up.railway.app`.
4. **Copy your connector password.** In the same service, open Variables and copy `CANVAS_CONNECTOR_PASSWORD`. Railway made it for you. Keep it somewhere safe, like a password manager.
5. **Add it to Claude.** On claude.ai in a browser, go to Settings > Connectors > Add custom connector. Name it `Canvas`, and for the address use your connector address with `/mcp` on the end, for example `https://something.up.railway.app/mcp`. Leave the advanced settings empty and click Add.
6. **Sign in.** Click Connect. A page titled "Connect your Canvas" opens. Paste your connector password and click Approve.
7. **Turn on sleep to save money.** In Railway, open the service, go to Settings, and turn on Serverless. It sleeps when you are not using it. The first question after a quiet stretch takes a few extra seconds; if it fails, just ask again.

Now ask Claude "what's due this week?" from any device signed in to your Claude account.

### Keeping it working

- **Your Canvas token expired.** Make a new token in Canvas, paste it into `CANVAS_TOKEN` under the service's Variables in Railway, and let it redeploy.
- **Lost your phone, or think someone saw your password?** Change `CANVAS_CONNECTOR_PASSWORD` in Railway to a new long random value. That signs everyone out at once. Then reconnect in Claude with the new password.
- **Done with it?** Delete the Railway project and revoke its token in Canvas.
- **Something wrong?** Ask Claude for your "Canvas setup status". In Railway, the service's Deploy Logs say why it did not start, for example a missing token.

Anyone with your connector password could read your Canvas information, so treat it like any other password.
