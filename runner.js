const { spawn } = require('child_process');
const path = require('path');

// 1. Set a fake secret in the parent environment. 
// We want to prove the child process CANNOT see this.
process.env.SUPER_SECRET_API_KEY = "pk_live_123456789_do_not_leak";

const MEM_LIMIT = 512;
const scriptPath = './spawn.js';

// 2. Spawn the completely locked-down child process
const childProcess = spawn('node', [
    `--max-old-space-size=${MEM_LIMIT}`,
    // '--experimental-permission',   
    // '--allow-child-process=false', 
    // '--allow-worker=false',        
    // '--allow-fs-write=false',      
    scriptPath
], {
    stdio: ['inherit', 'ignore', 'ignore', 'ipc'],
    // CRITICAL: Wiping the environment!
    env: {} 
});

// 3. The exact malicious payload you provided
const maliciousPayload = `
    return this.constructor.constructor(\`
      const { execSync } = process.getBuiltinModule('child_process');
      const envDump = execSync('env').toString();
      return envDump;
    \`)();
`;

// 4. Send the payload to the child process
console.log("Sending exploit to the sandbox...");
childProcess.send(maliciousPayload);

// 5. Listen for the result from the child process
childProcess.on('message', (response) => {
    console.log("\n--- RESULT FROM CHILD PROCESS ---");
    
    if (response.success) {
        console.error("❌ EXPLOIT SUCCEEDED! The sandbox is vulnerable.\n");
        console.log("Environment Dump:\n", response.data);
    } else {
        console.log("✅ EXPLOIT BLOCKED! Security measures worked.\n");
        console.log(`Error caught: ${response.code}`);
        console.log(`Error message: ${response.error}`);
    }
});

childProcess.on('exit', (code) => {
    console.log(`\nChild process exited with code ${code}`);
});