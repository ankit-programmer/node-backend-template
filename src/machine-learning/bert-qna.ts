// const tf = require('@tensorflow/tfjs-node');
const qna = require('@tensorflow-models/qna');

async function run() {
    const passage = "Hi, I am Ankit a software engineer. I am 28 and looking for a girl to marry. Can you help me find her?";
    const questions = ["What does Ankit do?", "What does Ankit want?", "How old is Ankit"];
    // Load the model.
    const model = await qna.load();

    // Finding the answers
    for (const question of questions) {

        const answers = await model.findAnswers(question, passage);

        console.log('Answers: ');
        console.log(answers);
    }
}

run();