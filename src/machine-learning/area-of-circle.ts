import * as tf from '@tensorflow/tfjs-node';
import * as path from 'path';

// Global variable to control training
// Set to true to train and save the model. Set to false to load the existing model.
const SHOULD_TRAIN = false;
const MODEL_PATH = 'file://' + path.resolve(__dirname, 'saved-models/area-of-circle');

// 1. Generate Synthetic Data
// We create radii from 1 to 50 to cover a wider range, including our test case of 25.
// 1. Better Data Generation
const dataSize = 500;
const radii: number[] = [];
const areas: number[] = [];

for (let i = 0; i < dataSize; i++) {
  // Use a mix of small and large numbers to give the model better "vision"
  const r = Math.random() * 200;
  radii.push(r);
  areas.push(Math.PI * Math.pow(r, 2));
}

// Normalize constants
const maxR = 200;
const maxArea = Math.PI * Math.pow(maxR, 2);

// Normalize Data: Scale to [0, 1]
const xs = tf.tensor2d(radii.map(r => r / maxR), [dataSize, 1]);
const ys = tf.tensor2d(areas.map(a => a / maxArea), [dataSize, 1]);

async function getModel(): Promise<tf.LayersModel> {
  let model;

  if (SHOULD_TRAIN) {
    model = tf.sequential();
    // Wider hidden layers help approximate the r^2 curve better
    model.add(tf.layers.dense({ units: 128, inputShape: [1], activation: 'relu' }));
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1 }));

    model.compile({
      loss: 'meanSquaredError',
      optimizer: tf.train.adam(0.01) // Slightly lower learning rate for stability
    });

    await model.fit(xs, ys, {
      epochs: 1000, // With normalization, you need fewer epochs
      shuffle: true,
      verbose: 0
    });

    await model.save(MODEL_PATH);
  } else {
    model = await tf.loadLayersModel(MODEL_PATH + '/model.json');
  }
  return model;
}

async function trainAndPredict() {
  try {
    const model = await getModel();

    // 4. Make a prediction
    // const radiusToTest = 2;
    // const prediction = model.predict(tf.tensor2d([radiusToTest], [1, 1])) as tf.Tensor;

    // const predictedValue = prediction.dataSync()[0];

    const radiusToTest = 450;
    const normalizedInput = tf.tensor2d([radiusToTest / maxR], [1, 1]);
    const prediction = model.predict(normalizedInput) as tf.Tensor;
    const predictedValue = prediction.dataSync()[0] * maxArea; // Re-scale back
    const actualValue = Math.PI * radiusToTest * radiusToTest;
    console.log(`Radius: ${radiusToTest}`);
    console.log(`Predicted Area: ${predictedValue.toFixed(2)}`);
    console.log(`Actual Area:    ${actualValue.toFixed(2)}`);
    console.log(`Difference:     ${Math.abs((predictedValue - actualValue) / actualValue * 100).toFixed(2)}`);
  } catch (err) {
    console.error('An error occurred:', err);
  }
}

trainAndPredict();