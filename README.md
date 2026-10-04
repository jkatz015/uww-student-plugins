# UW-Whitewater student plugins for Claude

## uww-canvas

Connects Claude Desktop to your UW-Whitewater Canvas account. Ask Claude about your courses, upcoming due dates, grades, assignment instructions, modules, discussions and course files.

- Your Canvas token is entered in a pop-up box on your own screen and saved encrypted on your computer. It never goes through a chat.
- Read-only by default. If you turn on submitting and posting, every submission or post still opens a box on your screen, and nothing goes to Canvas unless you click Yes.
- When Claude reads your Canvas information to answer you, that information is sent to Claude, like anything else you share in a chat.

## Setup (one time, about 5 minutes)

1. Install Node.js. On Windows, open PowerShell and run:
   `winget install OpenJS.NodeJS.LTS`
   Then close and reopen PowerShell and run `node -v`; it should print a version number. If winget is blocked (some school or work laptops) or you are on a Mac, download the LTS installer from https://nodejs.org instead.
2. In Claude Desktop, open Customize > Plugins > Add marketplace, and enter: `jkatz015/uww-student-plugins`
3. Find **uww-canvas** in the list and click Install. Then fully quit Claude (right-click its icon by the clock > Quit) and reopen it. Claude only finds Node.js after a full restart, so do not skip this.
4. In Canvas, go to Account > Settings > Approved Integrations > + New Access Token. Give it an expiration date (end of semester is good) and copy the token.
5. Ask Claude: "list my Canvas courses". A box titled "Canvas for Claude" pops up. Click in it, press Ctrl+V, check that it says "Token entered: N characters", and click Save. Ask again.

Never paste your token into the chat.

## Getting updates

On the Plugins page, open this marketplace and turn on **Sync automatically**, or click **Check for updates** now and then.

## When your token expires

Canvas will reject it and the plugin will forget it. Create a new token in Canvas, ask Claude anything about Canvas, and paste the new token into the pop-up box.

## Having trouble?

Ask Claude for your "Canvas setup status" and send the result to Jonathan. It shows what is going on without revealing your token.
