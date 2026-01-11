require('dotenv').config();
const { Buffer } = require('node:buffer');
const EventEmitter = require('events');
const fetch = require('node-fetch');

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

  // Generate a short mu-law (G.711 u-law) beep at 8kHz and return base64 string
  async generateBeep() {
    try {
      const sampleRate = 8000;
      const duration = 0.09; // seconds
      const samples = Math.floor(sampleRate * duration);
      const mu = 255;

      // Two partials for a pleasant 'bing' bell: main + harmonic
      const f1 = 1600; // main frequency
      const f2 = 2400; // harmonic

      const buf = Buffer.alloc(samples);

      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;

        // Slight frequency glide for a more bell-like attack
        const glide = 1 - Math.exp(-t * 40);
        const tone1 = Math.sin(2 * Math.PI * (f1 + 150 * (1 - glide)) * t);
        const tone2 = 0.45 * Math.sin(2 * Math.PI * (f2 + 80 * (1 - glide)) * t);

        // Exponential decay envelope
        const env = Math.exp(-t * 30);

        const pcm = env * (0.9 * tone1 + tone2);

        const sign = pcm < 0 ? -1 : 1;
        const magnitude = Math.log(1 + mu * Math.abs(pcm)) / Math.log(1 + mu);
        const muSample = sign * magnitude;

        const byte = Math.round((muSample + 1) * 127.5) & 0xff;
        buf[i] = byte;
      }

      return buf.toString('base64');
    } catch (err) {
      console.error('Error generating beep', err);
      return null;
    }
  }
}

module.exports = { TextToSpeechService };