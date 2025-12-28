require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/function-manifest');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};
tools.forEach((tool) => {
  const functionName = (tool && tool.function && tool.function.name) || tool.name;
  if (functionName) {
    try {
      availableFunctions[functionName] = require(`../functions/${functionName}`);
    } catch (e) {
      console.warn(`Warning: Function module not found for ${functionName}`);
    }
  }
});

class GptService extends EventEmitter {
  constructor() {
    super();
    this.openai = new OpenAI();
    this.userContext = [
      {
        role: "system",
        content: `
You are a helpful AI agent.
Keep responses brief.
Ask at most one question.
Do not assume values.
Use only plain text.
Do not use markdown, bullet formatting, or code blocks.
Do not include URLs, citations, or source references.
If information comes from web search, rewrite it as unattributed plain text.
End every sentence or natural pause with the symbol •
`.trim(),
      },
      {
        role: "assistant",
        content: "Hello! How can I help you?",
      },
    ];
    this.partialResponseIndex = 0;
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
    if (role === "tool") {
      this.userContext.push({ 'role': role, 'tool_call_id': name, 'content': text });
    } else if (name !== 'user') {
      this.userContext.push({ 'role': role, 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    this.updateUserContext(name, role, text);

    const streamOnce = async () => {
      const stream = await this.openai.responses.stream({
        model: 'gpt-5.2',
        input: this.userContext,
        tools: tools,
      });

      let completeResponse = '';
      let partialResponse = '';
      let functionName = '';
      let functionArgs = '';
      let functionCallId = '';
      let functionCallDone = false;

      for await (const event of stream) {
        // Debug the event for diagnosis
        console.log('GptService -> event:', JSON.stringify(event.type));
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
        } else if (event.type === 'response.output_item.added') {
          const item = event.item || {};
          if (item.type === 'function_call' && item.name && !functionName) {
            functionName = item.name;
          }
          if (item.type === 'function_call' && item.call_id && !functionCallId) {
            functionCallId = item.call_id;
          }
        } else if (event.type === 'response.function_call_arguments.delta') {
          if (typeof event.delta === 'string') functionArgs += event.delta;
          if (typeof event.arguments_delta === 'string') functionArgs += event.arguments_delta;
        } else if (event.type === 'response.function_call_arguments.done') {
          functionCallDone = true;
           
          // Break out to execute the function immediately
          break;
        } else if (event.type === "response.web_search_call.searching") {
          this.emit("gptreply", {
            partialResponseIndex: null,
            partialResponse: 'searching the web•'
          }, interactionCount);

        } else if (event.type === "response.completed") {
          // flush any remaining partialResponse
          if (partialResponse.trim().length > 0) {
            const gptReply = {
              partialResponseIndex: this.partialResponseIndex,
              partialResponse,
            };
            this.emit("gptreply", gptReply, interactionCount);
            this.partialResponseIndex++;
            partialResponse = "";
          }
        } else if (event.type === "response.error") {
          console.error("Responses stream error", event);
        }
      }

      if (functionCallDone && functionName) {
        return { type: 'function_call', name: functionName, id: functionCallId, args: functionArgs };
      }

      return { type: 'text', content: completeResponse };
    };

    try {
      // Loop to handle function calls until we finally get text output
      let safetyCounter = 0;
      while (safetyCounter < 5) {
        const result = await streamOnce();
        if (result.type === 'function_call') {

          const nameToCall = result.name;
          const callId = result.id;
          const argsObj = this.validateFunctionArgs(result.args || '{}') || {};
          const fn = availableFunctions[nameToCall];
          let toolOutput;
          if (typeof fn === 'function') {

            // Add the function call to the context
            this.userContext.push({
              type: "function_call",
              name: nameToCall,
              call_id: callId,
              arguments: JSON.stringify(argsObj),
            });

            try {
              toolOutput = await fn(argsObj);
            } catch (toolErr) {
              console.error(`Function ${nameToCall} failed:`, toolErr);
              toolOutput = { error: `Function ${nameToCall} failed: ${toolErr?.message || toolErr}` };
            }
          } else {
            toolOutput = { error: `Function not implemented: ${nameToCall}` };
          }

          // Provide tool output back into the context for the next round
            this.userContext.push({
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(toolOutput),
            });

          // Continue loop to let the model produce the final text answer
          safetyCounter += 1;
          continue;
        } else {
          // We received text; finalize and exit
          const content = result.content || '';
          if (content.trim().length > 0) {
            this.userContext.push({ role: 'assistant', content });
            console.log(`GPT -> user context length: ${this.userContext.length}`.green);
          }
          break;
        }
      }
    } catch (err) {
      console.error('OpenAI stream failed:', err?.message || err);
      console.log(JSON.stringify(this.userContext))
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
