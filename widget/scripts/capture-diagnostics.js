const fs = require("fs");
const os = require("os");
const path = require("path");

const OUTPUT_DIR = path.join(os.homedir(), "HOMEBOT_DIAG");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUTFILE = path.join(OUTPUT_DIR, `homebot-diagnostics-${TS}.log`);

global.__HOMEBOT_MAIN_LOG_BUFFER = global.__HOMEBOT_MAIN_LOG_BUFFER || [];
global.__HOMEBOT_RENDERER_LOG_BUFFER = global.__HOMEBOT_RENDERER_LOG_BUFFER || [];
global.__HOMEBOT_ROUTER_LOG_BUFFER = global.__HOMEBOT_ROUTER_LOG_BUFFER || [];
// Runtime log path
const RUNTIME_LOG = path.join(os.homedir(), 'HOMEBOT_DIAG', 'homebot-runtime.log');

function ensureDir() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function formatBuffer(name, arr) {
    return [
        "",
        "========================================================",
        `                      ${name}`,
        "========================================================",
        "",
        ...arr.slice(-300),
        ""
    ].join("\n");
}

function writeOut() {
    ensureDir();

    // If the app is running and wrote a runtime log, include that whole file
    let runtimeContent = [];
    try {
        if (fs.existsSync(RUNTIME_LOG)) {
            runtimeContent = fs.readFileSync(RUNTIME_LOG, 'utf8').split('\n');
        }
    } catch (e) { /* ignore */ }

    const content = [
        formatBuffer("RUNTIME LOG (combined)", runtimeContent),
    ].join("\n\n");

    fs.writeFileSync(OUTFILE, content, "utf8");

    console.log(`\n-------------------------------------------`);
    console.log(`HomeBot diagnostics written to:`);
    console.log(OUTFILE);
    console.log(`-------------------------------------------\n`);
}

writeOut();
