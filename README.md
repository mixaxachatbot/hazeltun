HAZELTUN PROXY — WINDOWS QUICK START

WHAT IS INCLUDED
  index.html          Website design, code-entry screen, and browser controls
  server.mjs          Local web server and proxy backend
  package.json        Project details (no extra packages are needed)
  start-hazeltun.bat  Double-click launcher for Windows
  public\logo.jpg     Your Hazeltun logo

RUN IT
1. Install Node.js 20 or newer from https://nodejs.org/ if Node is not installed.
2. Extract hazeltun-proxy.zip to a folder you can find, such as Documents\Hazeltun.
3. Open that extracted folder and double-click start-hazeltun.bat.
4. Leave the black server window open while you use the site.
5. In Chrome or Edge running on the same computer, open http://localhost:4173
6. Enter the access code: 4578

LOCALHOST EXPLAINED
"localhost" means this computer. It is not a public internet address. The server
must be running before the address works. Codex's in-app browser may run separately
and may not be able to access your computer's localhost; use Chrome or Edge directly.

TROUBLESHOOTING
• If the page says it cannot connect, make sure the black server window is still open.
• If port 4173 is already in use, close the other Hazeltun server window and reopen
  start-hazeltun.bat.
• If Windows says Node is missing, install Node.js 20+ and reopen the launcher.
• A few websites may not work through a simple proxy because they block embedding,
  require sign-in, or depend on browser features this lightweight proxy does not pass through.

The access code is checked by the local server. Successful access lasts four hours
or until you press Lock. To change the code, set the HAZELTUN_CODE environment
variable before starting the server.
