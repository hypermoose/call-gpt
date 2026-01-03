const EventEmitter = require('events');
const uuid = require('uuid');

class StreamService extends EventEmitter {
  constructor(websocket) {
    super();
    this.ws = websocket;
    this.expectedAudioIndex = 0;
    this.audioBuffer = {};
    this.streamSid = '';
  }

  setStreamSid (streamSid) {
    this.streamSid = streamSid;
  }

  reset() {
    this.expectedAudioIndex = 0;
    this.audioBuffer = {};
  }

  buffer (index, audio) {
    // Escape hatch for intro message, which doesn't have an index
    if(index === null) {
      console.log(`Twilio -> sendAudio immediate`);
      this.sendAudio(audio);
    } else if(index === this.expectedAudioIndex) {
      console.log(`Twilio -> sendAudio index: ${index}`);
      this.sendAudio(audio);
      this.expectedAudioIndex++;

      while(Object.prototype.hasOwnProperty.call(this.audioBuffer, this.expectedAudioIndex)) {
        const bufferedAudio = this.audioBuffer[this.expectedAudioIndex];
        console.log(`Twilio -> sendAudio queued index: ${this.expectedAudioIndex}`);
        this.sendAudio(bufferedAudio);
        this.expectedAudioIndex++;
      }
    } else {
      console.log(`Twilio -> queueing audio index: ${index}`);
      this.audioBuffer[index] = audio;
    }
  }

  sendAudio (audio) {
    this.ws.send(
      JSON.stringify({
        streamSid: this.streamSid,
        event: 'media',
        media: {
          payload: audio,
        },
      })
    );
    // When the media completes you will receive a `mark` message with the label
    const markLabel = uuid.v4();
    this.ws.send(
      JSON.stringify({
        streamSid: this.streamSid,
        event: 'mark',
        mark: {
          name: markLabel
        }
      })
    );
    this.emit('audiosent', markLabel);
  }
}

module.exports = {StreamService};