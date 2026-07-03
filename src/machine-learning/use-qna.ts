// import * as tf from '@tensorflow/tfjs-node';
// import * as use from '@tensorflow-models/universal-sentence-encoder';
const tf = require('@tensorflow/tfjs-node');
const use = require('@tensorflow-models/universal-sentence-encoder');

async function runQnADemo() {
    console.log('Loading USE QnA model...');
    const model = await use.loadQnA();

    // 1. Define your "Knowledge Base" (Candidate Answers)
    const responses = [
        "It offers many cloud communication services i.e email, sms otp, whatsapp etc",
        "Twellio offers similar services",
        "Today is a nice day"
    ];

    // 2. Define the Query
    const queries = ["What services are offered by MSG91"];

    console.log('Generating embeddings...');
    
    // The model embeds queries and responses into a shared 100-dimensional space
    const input = {
        queries: queries,
        responses: responses,
        contexts: ["MSG91 is a cloud communicaton provider", "Globally known email provider", "Nice sunny day"]
    };

    // Embeddings is a set of tensors
    const embeddings = model.embed(input);
    const queryEmbed = embeddings.queryEmbedding;     // Shape: [1, 100]
    const responseEmbed = embeddings.responseEmbedding; // Shape: [5, 100]

    // 3. Calculate Similarity using Dot Product
    // In a 100-D space, the dot product measures how "aligned" the vectors are.
    // We multiply query vector [1, 100] by the transposed response matrix [100, 5]
    const dotProduct = tf.matMul(queryEmbed, responseEmbed, false, true);
    
    // 4. Get the scores and find the best match
    const scores = await dotProduct.data();
    const results = Array.from(scores).map((score, i) => ({
        sentence: responses[i],
        score: score
    }));

    // Sort by highest score
    results.sort((a:any, b:any) => b.score - a.score);

    console.log('\n--- Results ---');
    results.forEach((res:any, i) => {
        console.log(`${i + 1}. [Score: ${res.score.toFixed(4)}] ${res.sentence}`);
    });

    // Cleanup tensors to prevent memory leaks
    queryEmbed.dispose();
    responseEmbed.dispose();
    dotProduct.dispose();
}

runQnADemo().catch(err => console.error(err));