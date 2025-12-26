require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/function-manifest');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};
tools.forEach((tool) => {
  let functionName = tool.name;
  availableFunctions[functionName] = require(`../functions/${functionName}`);
});

class GptService extends EventEmitter {
  constructor() {
    super();
    this.openai = new OpenAI();
    this.userContext = [
      { 'role': 'system', 'content': 'You are a helpful AI agent. You have a youthful and cheery personality. Keep your responses as brief as possible but make every attempt to keep the caller on the phone without being rude. Don\'t ask more than 1 question at a time. Don\'t make assumptions about what values to plug into functions. Ask for clarification if a user request is ambiguous. You must add a \'•\' symbol every 5 to 10 words at natural pauses where your response can be split for text to speech.' },
      { 'role': 'assistant', 'content': 'Hello! How can I help you?'},
    ],
    this.partialResponseIndex = 0;
  }

  // Add the callSid to the chat context in case
  // ChatGPT decides to transfer the call.
  setCallSid (callSid) {
    this.userContext.push({ 'role': 'system', 'content': `callSid: ${callSid}` });
  }

  validateFunctionArgs (args) {
    try {
      return JSON.parse(args);
    } catch (error) {
      console.log('Warning: Double function arguments returned by OpenAI:', args);
      // Seeing an error where sometimes we have two sets of args
      if (args.indexOf('{') != args.lastIndexOf('{')) {
        return JSON.parse(args.substring(args.indexOf(''), args.indexOf('}') + 1));
      }
    }
  }

  updateUserContext(name, role, text) {
    if (name !== 'user') {
      this.userContext.push({ 'role': role, 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    this.updateUserContext(name, role, text);

    try {
      // Step 1: Send user transcription to Chat GPT
      // Use the new Responses API with streaming
      const stream = await this.openai.responses.stream({
        // Valid, streaming-capable model that supports tools
        model: 'gpt-4o-mini',
        // Responses API expects `input` (can be an array of role-based messages)
        input: this.userContext,
        tools: tools,
      });

      let completeResponse = '';
      let partialResponse = '';
      let functionName = '';
      let functionArgs = '';
      let finishReason = '';

      function collectToolInformationFromChunk(event) {
        // Handle official Responses stream tool events
        if (event.type === 'response.tool_call.created') {
          const tc = event.tool_call || {};
          if (tc.name) functionName = tc.name;
          if (tc.arguments) functionArgs += tc.arguments;
        } else if (event.type === 'response.tool_call.delta') {
          // arguments may arrive in pieces
          const delta = event.delta || {};
          if (typeof delta.arguments === 'string') functionArgs += delta.arguments;
          if (typeof delta.arguments_delta === 'string') functionArgs += delta.arguments_delta;
        } else if (event.type === 'response.tool_call.done') {
          // nothing more to accumulate here; would normally trigger tool execution
        }
      }

      for await (const event of stream) {
        // Primary text stream for Responses API
        console.log('GptService -> event:', event.type);
        if (event.type === 'response.output_text.delta') {
          const contentChunk = typeof event.delta === 'string' ? event.delta : '';
          if (!contentChunk) continue;
          completeResponse += contentChunk;
          partialResponse += contentChunk;

          if (contentChunk.trim().slice(-1) === '•') {
            const gptReply = {
              partialResponseIndex: this.partialResponseIndex,
              partialResponse,
            };
            this.emit('gptreply', gptReply, interactionCount);
            this.partialResponseIndex++;
            partialResponse = '';
          }
        } else if (
          event.type === 'response.tool_call.created' ||
          event.type === 'response.tool_call.delta' ||
          event.type === 'response.tool_call.done'
        ) {
          collectToolInformationFromChunk(event);
        } else if (event.type === 'response.completed') {
          // flush any remaining partialResponse
          if (partialResponse.trim().length > 0) {
            const gptReply = {
              partialResponseIndex: this.partialResponseIndex,
              partialResponse,
            };
            this.emit('gptreply', gptReply, interactionCount);
            this.partialResponseIndex++;
            partialResponse = '';
          }
          // mark finishReason for compatibility
          finishReason = 'stop';
        } else if (event.type === 'response.error') {
          console.error('Responses stream error', event);
        } else if (event.type === 'response.output_text.done' || event.type === 'response.created') {
          // ignore, informational
        } // ignore other low-level events to avoid overfitting to SDK internals
      }
      this.userContext.push({'role': 'assistant', 'content': completeResponse});
      console.log(`GPT -> user context length: ${this.userContext.length}`.green);
    } catch (err) {
      console.error('OpenAI stream failed:', err?.message || err);
      // Fallback minimal message to keep the call flowing
      const gptReply = {
        partialResponseIndex: this.partialResponseIndex,
        partialResponse: 'Sorry, I am having trouble right now.'
      };
      this.emit('gptreply', gptReply, interactionCount);
      this.partialResponseIndex++;
    }
  }
}

module.exports = { GptService };
