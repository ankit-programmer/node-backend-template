const vm = require('vm');

// Listen for the payload sent from the parent process
process.on('message', (payload) => {
    try {
        // 1. Create a VULNERABLE sandbox context (inherits Object prototype)
        const context = {}; 
        vm.createContext(context);

        // 2. Execute the payload
        const result = vm.runInContext(payload, context);

        // 3. Send the result back to the parent
        process.send({ success: true, data: result });
    } catch (err) {
        // If our process-level security works, it should throw an error here
        process.send({ 
            success: false, 
            error: err.message, 
            code: err.code || 'UNKNOWN_ERROR' 
        });
    }
    
    // Exit after processing
    process.exit(0);
});