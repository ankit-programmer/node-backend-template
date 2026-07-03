const amqp = require('amqplib');

async function replicateError() {
  let connection;
  try {
    // 1. Connect and create a channel normally
    connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();
    console.log('✅ Channel created.');

    // 2. Initiate an operation that requires a broker reply (RPC),
    // but crucially, DO NOT `await` it yet.
    const pendingOperation = channel.assertQueue('test_queue', { durable: true });
    console.log('📤 Sent assertQueue request to broker...');

    // 3. Immediately kill the channel locally. 
    // This simulates a sudden drop before the broker's acknowledgment can travel back over the network.
    await channel.close();
    // await channel.assertQueue('test_queue', { durable: true });
    console.log('💥 Channel intentionally closed.');

    // 4. Now, attempt to await the original operation.
    // The amqplib library will realize the channel is dead and reject the pending promise.
    await pendingOperation;

  } catch (error) {
    console.error('\n🎯 Error Successfully Replicated:');
    console.error(error.toString());
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

replicateError();