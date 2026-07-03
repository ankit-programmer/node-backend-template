import { verbose } from "winston";

const tf = require('@tensorflow/tfjs-node');
// const tf = require('@tensorflow/tfjs');

async function run() {
    // 1. Data: Area = PI * (r^2)
    // We use a wider range to give the optimizer more "slope" to learn from
    const radiiSquared = [];
    const areas = [];
    for (let i = 1; i <= 500; i++) {
        radiiSquared.push(i * i);
        areas.push(Math.PI * i * i);
    }

    const xs = tf.tensor2d(radiiSquared, [500, 1]);
    const ys = tf.tensor2d(areas, [500, 1]);

    // 2. Model: A single neuron is all we need for a linear relationship
    const model = tf.sequential();
    model.add(tf.layers.dense({
        units: 1,
        inputShape: [1],
        useBias: true // We'll let it learn that bias is ~0
    }));

    // 3. Optimizer: Using a specific learning rate (0.01 is a good middle ground)
    const optimizer = tf.train.adam(0.1);
    model.compile({ loss: 'meanSquaredError', optimizer: optimizer });

    console.log('Training... Please wait.');

    // 4. Fit: We run more epochs to ensure precision
    await model.fit(xs, ys, {
        epochs: 1000,
        logging: false,
        verbose: 0,
        callbacks: {
            onEpochEnd: (epoch: any, logs: any) => {
                if (epoch % 100 === 0) console.log(`Epoch ${epoch}: Loss = ${logs.loss.toFixed(4)}`);
            }
        }
    });

    // 5. Inspect the "Math" the model learned
    const weight = model.getWeights()[0].dataSync()[0];
    const bias = model.getWeights()[1].dataSync()[0];
    console.log(`\nModel learned: Area = (${weight.toFixed(4)} * r^2) + ${bias.toFixed(4)}`);
    console.log(`Target was: Area = (${Math.PI.toFixed(4)} * r^2) + 0\n`);

    // 6. Test with 75
    const testR = 2;
    const pred = model.predict(tf.tensor2d([testR * testR], [1, 1]));
    const result = (await pred.data())[0];

    console.log(`Result for Radius 75: ${result.toFixed(2)}`);
    console.log(`Actual: ${(Math.PI * 75 * 75).toFixed(2)}`);
}

run();