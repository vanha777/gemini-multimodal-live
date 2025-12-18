/**
 * Handles playing back PCM 16-bit audio chunks from the server.
 */
export class AudioStreamer {
    private audioContext: AudioContext;
    private audioQueue: Int16Array[] = [];
    private isPlaying: boolean = false;
    private sampleRate: number = 24000; // Gemini often returns 24kHz
    private gainNode: GainNode;
    private scheduledTime: number = 0;

    constructor(context: AudioContext) {
        this.audioContext = context;
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
    }

    addPCM16(chunk: Uint8Array) {
        const float32Array = new Float32Array(chunk.length / 2);
        const dataView = new DataView(chunk.buffer);

        for (let i = 0; i < chunk.length / 2; i++) {
            // Little-endian
            const int16 = dataView.getInt16(i * 2, true);
            float32Array[i] = int16 / 32768;
        }

        const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, this.sampleRate);
        audioBuffer.getChannelData(0).set(float32Array);

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gainNode);

        const currentTime = this.audioContext.currentTime;
        if (this.scheduledTime < currentTime) {
            this.scheduledTime = currentTime;
        }

        source.start(this.scheduledTime);
        this.scheduledTime += audioBuffer.duration;
    }

    async resume() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    connectToAnalyser(analyser: AnalyserNode) {
        this.gainNode.connect(analyser);
    }

    stop() {
        this.scheduledTime = 0;
        // Note: stopping already scheduled sources is complex without tracking them, 
        // but for 'Stop' button we usually tear down the context or disconnect.
        this.gainNode.disconnect();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
    }
}
