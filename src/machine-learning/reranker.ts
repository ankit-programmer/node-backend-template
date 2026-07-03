import * as tf from '@tensorflow/tfjs';

// ==========================================
// 1. Human Feedback Data (Ground Truth)
// ==========================================
// Imagine humans rated these Query-Chunk pairs.
// 1.0 = Perfect match, 0.0 = Irrelevant
const humanFeedbackSamples = [
  // Query: "apple" (Ambiguous: could be fruit or tech)
  { query: "apple", chunk: "Apple released the new iPhone today.", relevance: 1.0 },
  { query: "apple", chunk: "The apple pie recipe requires sugar.", relevance: 0.1 }, // Assuming user meant Tech based on other data
  { query: "apple", chunk: "Oranges are widely grown in Florida.", relevance: 0.0 },
  
  // Query: "fruit"
  { query: "fruit", chunk: "Bananas are rich in potassium.", relevance: 1.0 },
  { query: "fruit", chunk: "Apple released the new iPhone today.", relevance: 0.0 }, // Not a fruit in this context
  { query: "fruit", chunk: "The apple pie recipe requires sugar.", relevance: 1.0 },

  // Query: "deployment"
  { query: "deployment", chunk: "Docker containers make deployment easy.", relevance: 1.0 },
  { query: "deployment", chunk: "The troops were deployed to the border.", relevance: 0.2 }, // Different sense of word
  { query: "deployment", chunk: "Bananas are rich in potassium.", relevance: 0.0 },
  
  // Query: "container"
  { query: "container", chunk: "Docker containers make deployment easy.", relevance: 1.0 },
  { query: "container", chunk: "Store the food in a plastic container.", relevance: 0.8 }, // Literal container
  { query: "container", chunk: "The variable contains a string.", relevance: 0.1 },
];

// ==========================================
// 2. Preprocessing (Shared Vocabulary)
// ==========================================
const allText = humanFeedbackSamples.map(s => s.query + " " + s.chunk).join(" ");

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length > 0);
}

const vocabulary = Array.from(new Set(tokenize(allText)));
const vocabSize = vocabulary.length;

// Encode text into a simple Multi-Hot Vector
function encode(text: string): number[] {
  const tokens = tokenize(text);
  const vector = new Array(vocabSize).fill(0);
  tokens.forEach(t => {
    const idx = vocabulary.indexOf(t);
    if (idx !== -1) vector[idx] = 1;
  });
  return vector;
}

// Create Training Tensors
// Input: [Query Vector ... Chunk Vector] (Concatenated)
// This allows the model to learn interactions between query terms and chunk terms.
const inputs = humanFeedbackSamples.map(sample => [
  ...encode(sample.query), 
  ...encode(sample.chunk)
]);
const labels = humanFeedbackSamples.map(sample => sample.relevance);

const xs = tf.tensor2d(inputs);
const ys = tf.tensor2d(labels, [labels.length, 1]);

// ==========================================
// 3. Define Model (The Reranker)
// ==========================================
async function run() {
  const model = tf.sequential();

  // Input size = vocabSize * 2 (Query + Chunk)
  model.add(tf.layers.dense({
    inputShape: [vocabSize * 2],
    units: 32,
    activation: 'relu'
  }));

  model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
  
  // Output: Score 0 to 1
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

  model.compile({
    optimizer: tf.train.adam(0.05),
    loss: 'meanSquaredError', // Regression since labels are 0.0 - 1.0
  });

  console.log('Training Reranker on Human Feedback...');
  await model.fit(xs, ys, { epochs: 100, verbose: 0 });
  console.log('Training complete.\n');

  // ==========================================
  // 4. Rerank Function
  // ==========================================
  async function rerank(query: string, chunks: string[]) {
    console.log(`Query: "${query}"`);
    console.log('Original Order:', chunks.map((c, i) => `\n  ${i+1}. ${c}`).join(''));

    // Create inputs for the model
    const inputs = chunks.map(chunk => [...encode(query), ...encode(chunk)]);
    const inputTensor = tf.tensor2d(inputs);

    // Predict scores
    const predictionTensor = model.predict(inputTensor) as tf.Tensor;
    const scores = await predictionTensor.data();

    // Combine chunks with scores
    const scoredChunks = chunks.map((chunk, i) => ({
      chunk,
      score: scores[i]
    }));

    // SORT (Rerank) by score descending
    scoredChunks.sort((a, b) => b.score - a.score);

    console.log('\nReranked Order (AI Score):');
    scoredChunks.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.score.toFixed(4)}] ${item.chunk}`);
    });
    console.log('------------------------------------------------');
  }

  // ==========================================
  // 5. Test It
  // ==========================================
  
  // Scenario 1: Ambiguous "Apple"
  // (The model saw in training that "apple" + "iphone" = 1.0)
  await rerank("apple", [
    "Oranges are widely grown in Florida.",
    "Apple released the new iPhone today.",
    "The apple pie recipe requires sugar."
  ]);

  // Scenario 2: "Container"
  // (The model saw that "container" + "docker" = 1.0, "plastic" = 0.8)
  await rerank("container", [
    "The variable contains a string.",
    "Docker containers make deployment easy.",
    "Store the food in a plastic container."
  ]);
}

run().catch(console.error);
