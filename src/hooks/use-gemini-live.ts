import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioStreamer } from '../utils/audio-streamer';

export type LiveStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useGeminiLive({ apiKey }: { apiKey: string }) {
    const [status, setStatus] = useState<LiveStatus>('disconnected');
    const [isRecording, setIsRecording] = useState(false);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const [volumeLevel, setVolumeLevel] = useState({ user: 0, ai: 0 });

    // Refs for persistence without re-renders
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const audioStreamerRef = useRef<AudioStreamer | null>(null);
    const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Volumne Analysis Refs
    const userAnalyserRef = useRef<AnalyserNode | null>(null);
    const aiAnalyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const connect = useCallback(async () => {
        if (!apiKey) {
            console.error("API Key is required");
            return;
        }

        try {
            setStatus('connecting');

            // 1. Setup AudioContext
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 24000,
            });
            await audioContext.resume();
            audioContextRef.current = audioContext;

            // Setup Analysers
            const userAnalyser = audioContext.createAnalyser();
            userAnalyser.fftSize = 256;
            userAnalyserRef.current = userAnalyser;

            const aiAnalyser = audioContext.createAnalyser();
            aiAnalyser.fftSize = 256;
            aiAnalyserRef.current = aiAnalyser;

            // Setup Streamer (connects to AI analyser)
            const streamer = new AudioStreamer(audioContext);
            // We need to tap into the streamer's source to feed the analyser
            // *Note*: AudioStreamer implementation needs a way to expose its gain node or connect it.
            // For now, we'll assume we can pass the analyser to the streamer or modify the streamer.
            // Let's modify the Streamer to connect to analyser before destination.
            streamer.connectToAnalyser(aiAnalyser);
            audioStreamerRef.current = streamer;

            // 2. Setup WebSocket
            const uri = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
            const ws = new WebSocket(uri);

            ws.onopen = () => {
                console.log("WebSocket Connected");
                setStatus('connected');

                const setupMsg = {
                    setup: {
                        model: "models/gemini-2.0-flash-exp",
                        generation_config: {
                            response_modalities: ["AUDIO"]
                        }
                    }
                };
                ws.send(JSON.stringify(setupMsg));
                startAnalysisLoop();
            };

            ws.onmessage = async (event) => {
                const data = JSON.parse(await event.data.text());
                if (data.serverContent?.modelTurn?.parts) {
                    for (const part of data.serverContent.modelTurn.parts) {
                        if (part.inlineData) {
                            const binaryString = atob(part.inlineData.data);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            streamer.addPCM16(bytes);
                        }
                    }
                }
            };

            ws.onclose = () => {
                console.log("WebSocket Disconnected");
                setStatus('disconnected');
                stopAnalysisLoop();
            };

            ws.onerror = (err) => {
                console.error("WebSocket Error", err);
                setStatus('error');
                stopAnalysisLoop();
            };

            wsRef.current = ws;

            // 3. Start Media Capture (Audio + Video)
            await startMedia(audioContext, ws, userAnalyser);

        } catch (error) {
            console.error("Connection Failed", error);
            setStatus('error');
        }
    }, [apiKey]);

    const startMedia = async (context: AudioContext, ws: WebSocket, userAnalyser: AnalyserNode) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                },
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 } // Lower framerate for streaming efficiency
                }
            });
            mediaStreamRef.current = stream;
            setVideoStream(stream);

            // Audio Chain: Source -> Analyser -> Worklet
            const source = context.createMediaStreamSource(stream);
            source.connect(userAnalyser); // Connect for visualizer

            await context.audioWorklet.addModule('/worklets/pcm-processor.js');
            const worklet = new AudioWorkletNode(context, 'pcm-processor');

            worklet.port.onmessage = (event) => {
                if (ws.readyState === WebSocket.OPEN) {
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(event.data)));
                    const msg = {
                        realtime_input: {
                            media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: base64 }]
                        }
                    };
                    ws.send(JSON.stringify(msg));
                }
            };

            userAnalyser.connect(worklet); // Pass through analyser to worklet
            audioWorkletNodeRef.current = worklet;
            setIsRecording(true);

            // Start Video Frame Transmission Loop
            startVideoTransmission(ws, stream);

        } catch (err) {
            console.error("Error starting media", err);
        }
    };

    const startVideoTransmission = (ws: WebSocket, stream: MediaStream) => {
        const videoTrack = stream.getVideoTracks()[0];
        const imageCapture = new (window as any).ImageCapture(videoTrack);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.play();

        const frameInterval = 200; // 5 FPS

        videoIntervalRef.current = setInterval(async () => {
            if (ws.readyState === WebSocket.OPEN && video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth * 0.5; // Scale down for bandwidth
                canvas.height = video.videoHeight * 0.5;
                ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

                const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
                const msg = {
                    realtime_input: {
                        media_chunks: [{ mime_type: "image/jpeg", data: base64 }]
                    }
                };
                ws.send(JSON.stringify(msg));
            }
        }, frameInterval);
    };

    const startAnalysisLoop = () => {
        const loop = () => {
            if (userAnalyserRef.current && aiAnalyserRef.current) {
                const userBuffer = new Uint8Array(userAnalyserRef.current.frequencyBinCount);
                const aiBuffer = new Uint8Array(aiAnalyserRef.current.frequencyBinCount);

                userAnalyserRef.current.getByteFrequencyData(userBuffer);
                aiAnalyserRef.current.getByteFrequencyData(aiBuffer);

                const userAvg = userBuffer.reduce((a, b) => a + b, 0) / userBuffer.length;
                const aiAvg = aiBuffer.reduce((a, b) => a + b, 0) / aiBuffer.length;

                setVolumeLevel({ user: userAvg, ai: aiAvg });
            }
            animationFrameRef.current = requestAnimationFrame(loop);
        };
        loop();
    };

    const stopAnalysisLoop = () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };

    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
            setVideoStream(null);
        }
        if (videoIntervalRef.current) {
            clearInterval(videoIntervalRef.current);
            videoIntervalRef.current = null;
        }
        if (audioWorkletNodeRef.current) {
            audioWorkletNodeRef.current.disconnect();
            audioWorkletNodeRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (audioStreamerRef.current) {
            audioStreamerRef.current.stop();
            audioStreamerRef.current = null;
        }
        setStatus('disconnected');
        setIsRecording(false);
        stopAnalysisLoop();
    }, []);

    return { connect, disconnect, status, isRecording, videoStream, volumeLevel };
}
