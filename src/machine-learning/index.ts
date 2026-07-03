import * as tf from '@tensorflow/tfjs';

// ========================================== 
// 1. Prepare Data
// ========================================== 
const codeSamples = [
  "const a = 10;",
  "function add(x, y) { return x + y; }",
  "import React from 'react';",
  "console.log('Hello world');",
  "if (x > 0) { print(x); }",
  "let user = { name: 'John', age: 30 };",
  "return x * 2;",
  "const [data, setData] = useState(null);",
  "for (let i = 0; i < 10; i++) {}",
  "class User extends Person { constructor() {} }",
  "x.map(item => item.id)",
  "export default function App() {}",
  "const express = require('express');",
  "app.listen(3000, () => {});",
  "document.getElementById('root');"
];

const textSamples = [
  "Hello, how are you doing today?",
  "The weather is nice outside.",
  "I went to the supermarket to buy milk.",
  "This is a simple sentence.",
  "Machine learning is fascinating.",
  "Can you help me with this task?",
  "The quick brown fox jumps over the lazy dog.",
  "I am reading a book about history.",
  "What is the capital of France?",
  "See you later, alligator.",
  "Have a great day ahead.",
  "I need to call my friend.",
  "The cat is sleeping on the sofa.",
  "Let's go for a walk in the park.",
  "Dinner will be ready at 7 PM."
];

// Combine data: Code = 1, Text = 0
const allSamples = [...codeSamples, ...textSamples];
const labels = [
  ...Array(codeSamples.length).fill(1), 
  ...Array(textSamples.length).fill(0)
];

// ========================================== 
// 2. Preprocessing (Bag of Words)
// ========================================== 

// Simple tokenizer: pads punctuation with space, lowercases, and splits
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([(){};,[\]=.])/g, ' $1 ') // Pad specific code-like punctuation
    .split(/\s+/) // Corrected: escaped backslash for regex
    .filter(t => t.length > 0);
}

// Build Vocabulary
const vocabulary = new Set<string>();
allSamples.forEach(text => {
  tokenize(text).forEach(token => vocabulary.add(token));
});

const vocabList = Array.from(vocabulary);
const vocabSize = vocabList.length;

console.log(`Vocabulary Size: ${vocabSize}`);

// Encoder: Converts text to a One-Hot encoded vector (Multi-hot actually)
function encode(text: string): number[] {
  const tokens = tokenize(text);
  const vector = new Array(vocabSize).fill(0);
  tokens.forEach(token => {
    const index = vocabList.indexOf(token);
    if (index !== -1) {
      vector[index] = 1;
    }
  });
  return vector;
}

// Prepare Tensors
const xs = tf.tensor2d(allSamples.map(encode));
const ys = tf.tensor2d(labels, [labels.length, 1]);

// ========================================== 
// 3. Define & Train Model
// ========================================== 
async function run() {
  const model = tf.sequential();

  // Input layer: Size of vocabulary
  model.add(tf.layers.dense({
    inputShape: [vocabSize],
    units: 16,
    activation: 'relu'
  }));

  // Output layer: 1 unit (Binary classification: 0 or 1)
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  console.log('Training Code vs. Text Classifier...');

  await model.fit(xs, ys, {
    epochs: 40,
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if ((epoch + 1) % 10 === 0) {
          console.log(`Epoch ${epoch + 1}: loss = ${logs?.loss.toFixed(4)}, acc = ${logs?.acc.toFixed(4)}`);
        }
      }
    }
  });

  console.log('Training complete.\n');

  // ========================================== 
  // 4. Test on New Data
  // ========================================== 
  const testPhrases = [
    "var x = 100;",                   // Obvious Code
    "I love programming.",            // Text with "programming" keyword
    "function hello() { return 1; }", // Obvious Code
    "Where is the library?",          // Obvious Text
    "const val = data.map(d => d);",  // Complex Code
    "console.log('text inside code')", // Tricky
    "// This is a comment"
  ];

  console.log('--- Testing Predictions ---');
  for (const text of testPhrases) {
    const inputVector = tf.tensor2d([encode(text)]);
    const prediction = model.predict(inputVector) as tf.Tensor;
    const score = (await prediction.data())[0];
    
    // Score > 0.5 means "Code" (Label 1), < 0.5 means "Text" (Label 0)
    const label = score > 0.5 ? "CODE" : "TEXT";
    const confidence = (score > 0.5 ? score : 1 - score) * 100;
    
    console.log(`"${text}"
  -> [${label}] (${confidence.toFixed(1)}%)
`);
  }
}

run().catch(console.error);