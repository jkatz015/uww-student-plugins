# UW-Whitewater Canvas for Claude

Connects Claude Desktop to UW-Whitewater Canvas (https://uwwtw.instructure.com).

## What Claude can do

- List your courses, assignments, upcoming due dates (shown in Central time), grades, modules and discussions
- Read full assignment instructions and rubrics
- Download course files
- Submit assignments and post discussion replies, only after you turn this on. Every submission or post opens a box on your screen showing what will be sent, and nothing goes to Canvas unless you click Yes.

## Before you install

Install Node.js. On Windows, run `winget install OpenJS.NodeJS.LTS` in PowerShell (or use the LTS installer from https://nodejs.org, which is also the way on a Mac). Then fully quit and reopen Claude Desktop so it finds Node.js.

## Setup

1. Install this plugin in Claude Desktop.
2. In Canvas, go to Account > Settings > Approved Integrations > + New Access Token, and copy the token.
3. Ask Claude: "list my Canvas courses".
4. A box titled "Canvas for Claude" pops up. Paste your token and click Save.

Your token is saved only on your computer, encrypted so only your Windows login can read it (on a Mac, in your Keychain). Never paste it into a chat.

Tip: when creating the token in Canvas, set an expiration date, such as the end of the semester.

## Turning submitting and posting on or off

They start OFF. The first time you ask Claude to submit or post, a box asks whether to turn them on. To turn them off again, delete the `allow-write` file inside the `.canvas-mcp` folder in your user folder.

## Changing or resetting your token

Windows: delete the `.canvas-mcp` folder in your user folder. Mac: delete "uww-canvas" in Keychain Access. The next Canvas request asks again. If Canvas rejects a token, the plugin forgets it and asks again automatically. If you stop using the plugin, also delete the token in Canvas under Approved Integrations.

## Settings (in .mcp.json)

| Variable | Value | Meaning |
|---|---|---|
| CANVAS_URL | https://uwwtw.instructure.com | UW-Whitewater Canvas |
| CANVAS_TZ | America/Chicago | Time zone for due dates |
| CANVAS_ALLOW_WRITE | false | Leave false. Students turn writing on in an on-screen box; true skips that step, but every write still needs an on-screen Yes. |
| CANVAS_TOKEN | (optional) | If set, used instead of the pop-up |
