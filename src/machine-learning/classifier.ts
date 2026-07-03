import axios from "axios";
import * as tf from '@tensorflow/tfjs-node';

const EMBEDDING_SERVER = process.env.EMBEDDING_SERVER || 'http://embedding.rtlayer.com';

const CLASSES = ['BUG_REPORT', 'FEATURE_REQUEST', 'DOCS_QUESTION', 'BILLING'];

async function runTrustTest() {
    // 1. Raw Training Data
    const rawData = [
        // --- BUG_REPORT (Class 0) ---
        "The app crashes immediately on startup",
        "Received a 500 internal server error when saving profile",
        "Database connection timeout during heavy load",
        "The app hangs on the loading screen and never finishes",
        "Images are not rendering correctly in the user gallery",
        "The login button does nothing when clicked in Chrome",
        "Memory leak detected in the background sync process",
        "Keyboard remains open after submitting the form on mobile",
        "Application freezes after the latest firmware update",
        "Permission denied error even with a valid auth token",

        // --- FEATURE_REQUEST (Class 1) ---
        "DARK MODE please! My eyes are hurting at night",
        "Add an option to export all data to CSV format",
        "I want Slack integration for real-time notifications",
        "Ability to bulk upload attachments in the message thread",
        "White-labeling options for sub-accounts would be great",
        "Can we integrate with Google Calendar for scheduling?",
        "Add a 'Select All' checkbox in the user management list",
        "Provide an API for webhooks to track event changes",
        "Export reports directly to PDF for easier sharing",
        "Add a night shift mode for the admin dashboard",

        // --- DOCS_QUESTION (Class 2) ---
        "How do I set environment variables for production?",
        "Where can I find the latest API documentation?",
        "Is there a setup guide for running this on Linux?",
        "How do I upgrade to the latest SDK version safely?",
        "Is there a rate limit for the public API endpoints?",
        "Where can I find the security and compliance documents?",
        "What are the minimum hardware requirements for self-hosting?",
        "How do I implement custom authentication providers?",
        "Do you have a code snippet for the Node.js client?",
        "Explanation for the 'insufficient_scope' error code",

        // --- BILLING (Class 3) ---
        "I was double charged on my card this month",
        "I want to refund my subscription for the last period",
        "How do I update my credit card and billing info?",
        "I need to download my last 3 invoices for accounting",
        "Why was I charged for a canceled subscription?",
        "Can I switch from monthly to annual billing plans?",
        "Is there a discount for non-profit organizations?",
        "My card was declined but the funds were still held",
        "How can I add my VAT number to the monthly invoice?",
        "I want to cancel my paid plan and get my money back"
    ];

    const rawLabels = [
        ...Array(10).fill(0), // 0-9: BUG_REPORT
        ...Array(10).fill(1), // 10-19: FEATURE_REQUEST
        ...Array(10).fill(2), // 20-29: DOCS_QUESTION
        ...Array(10).fill(3)  // 30-39: BILLING
    ];

    console.log('✨ Encoding text into BGE embeddings...');
    const embeddings = await generateEmbedding(rawData);

    // 2. Prepare Tensors
    const xs = tf.tensor2d(embeddings); // [12, 1024]
    const ys = tf.oneHot(tf.tensor1d(rawLabels, 'int32'), 4); // [12, 4]

    // 3. Build the "Head" Model
    const model = tf.sequential();

    // 1. Smaller layer + L2 Regularization
    // L2(0.01) prevents the model from "over-trusting" any single part of the BGE vector
    model.add(tf.layers.dense({
        units: 32,
        inputShape: [1024],
        activation: 'relu',
        kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
    }));

    model.add(tf.layers.dropout({ rate: 0.4 })); // Be aggressive with dropout

    model.add(tf.layers.dense({
        units: 4,
        activation: 'softmax'
    }));

    model.compile({
        optimizer: tf.train.adam(0.0005), // Slower learning rate for stability
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
    });


    // 4. Training with Validation Split
    // validationSplit: 0.2 means 20% of data is hidden from the model to test it
    console.log('🚀 Training classifier...');
    await model.fit(xs, ys, {
        epochs: 500,
        // validationSplit: 0.2, // It hides last 20% of data from training
        validationSplit: 0,
        verbose: 0,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch: any, logs: any) => {
                if (epoch % 10 === 0) {
                    // console.log(`Epoch ${epoch}: Acc=${logs?.acc?.toFixed(2)} | Val_Acc=${logs?.val_acc.toFixed(2)}`);
                }
            }
        }
    });

    // 5. THE TEST: Predict something the model has NEVER seen
    const testText = "Is there any charge to cancle my subscription";
    console.log(`\nTesting new query: "${testText}"`);

    const testEmbedding = await generateEmbedding([testText]);
    const prediction = model.predict(tf.tensor2d(testEmbedding)) as tf.Tensor;
    const scores = await prediction.data();
    const resultIdx = prediction.argMax(-1).dataSync()[0];

    console.log(`Result: ${CLASSES[resultIdx]} (Confidence: ${(scores[resultIdx] * 100).toFixed(1)}%)`);
}
runTrustTest();


export async function generateEmbedding(texts: string[], model: string = "BAAI/bge-large-en-v1.5"): Promise<number[][]> {
    const batchSize = 10;
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        try {
            const response = await axios.post(`${EMBEDDING_SERVER}/embed`, {
                model: model,
                texts: batch
            });
            embeddings.push(...response.data.embeddings);
        } catch (error) {
            console.error('Error fetching embeddings:', error);
            throw error;
        }
    }
    return embeddings;
}