require('dotenv').config();
const { Buffer } = require('node:buffer');
const EventEmitter = require('events');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class TextToSpeechService extends EventEmitter {
  constructor() {
    super();
    this.nextExpectedIndex = 0;
    this.speechBuffer = {};
    this.isAborted = false;
  }

  reset() {
    this.nextExpectedIndex = 0;
    this.speechBuffer = {};
    this.isAborted = true;
  }

  async generate(gptReply, interactionCount) {
    const { partialResponseIndex, partialResponse } = gptReply;

    if (!partialResponse) {
      return;
    }

    this.isAborted = false;

    // trim the • symbols for TTS processing
    const ttsText = partialResponse
      .replace(/•/g, '')
      .trim();

    try {
      const response = await fetch(
        `https://api.deepgram.com/v1/speak?model=${process.env.VOICE_MODEL}&encoding=mulaw&sample_rate=8000&container=none`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: ttsText,
          }),
        }
      );

      if (response.status === 200) {
        try {
          const blob = await response.blob();
          const audioArrayBuffer = await blob.arrayBuffer();
          const base64String = Buffer.from(audioArrayBuffer).toString("base64");
          if (!this.isAborted) {
            this.emit(
              "speech",
              partialResponseIndex,
              base64String,
              partialResponse,
              interactionCount
            );
          } else {
            console.log("TTS generation aborted, not emitting speech.".red);
          }
        } catch (err) {
          console.log(err);
        }
      } else {
        console.log("Deepgram TTS error:");
        console.log(response);
      }
    } catch (err) {
      console.error("Error occurred in TextToSpeech service");
      console.error(err);
    }
  }

  async generateBeep() {
    try {
      const envPath = process.env.BEEP_FILE
        ? path.resolve(process.env.BEEP_FILE)
        : null;
      const defaultPath = path.resolve(__dirname, "..", "assets", "wake.ulaw");

      const tryPaths = [];
      if (envPath) tryPaths.push(envPath);
      tryPaths.push(defaultPath);

      for (const p of tryPaths) {
        if (fs.existsSync(p)) {
          const fileBuf = fs.readFileSync(p);
          return fileBuf.toString("base64");
        }
      }

      return null;

    } catch (err) {
      console.error("Error generating beep", err);
      return null;
    }
  }
}

module.exports = { TextToSpeechService };