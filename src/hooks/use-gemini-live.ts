import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioStreamer } from '../utils/audio-streamer';

export type LiveStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type Message = {
    role: 'user' | 'model' | 'system';
    text: string;
};

export function useGeminiLive({ apiKey, systemInstruction }: { apiKey: string, systemInstruction?: string }) {
    const [status, setStatus] = useState<LiveStatus>('disconnected');
    const [isRecording, setIsRecording] = useState(false);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const [volumeLevel, setVolumeLevel] = useState({ user: 0, ai: 0 });
    const [messages, setMessages] = useState<Message[]>([]);

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null); // Screen Share
    const audioStreamRef = useRef<MediaStream | null>(null); // Mic
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const audioStreamerRef = useRef<AudioStreamer | null>(null);

    // Intervals
    const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Analysers
    const userAnalyserRef = useRef<AnalyserNode | null>(null);
    const aiAnalyserRef = useRef<AnalyserNode | null>(null);

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

            const userAnalyser = audioContext.createAnalyser();
            userAnalyser.fftSize = 256;
            userAnalyserRef.current = userAnalyser;

            const aiAnalyser = audioContext.createAnalyser();
            aiAnalyser.fftSize = 256;
            aiAnalyserRef.current = aiAnalyser;

            const streamer = new AudioStreamer(audioContext);
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
                        },
                        system_instruction: systemInstruction ? {
                            parts: [{ text: systemInstruction }]
                        } : undefined
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
                        if (part.text) {
                            console.log("Received text:", part.text);
                            setMessages(prev => [...prev, { role: 'model', text: part.text }]);
                        }
                    }
                }
            };

            ws.onclose = (event) => {
                console.log("WebSocket Disconnected", event.code, event.reason);
                setStatus('disconnected');
                cleanup();
            };

            ws.onerror = (err) => {
                console.error("WebSocket Error", err);
                setStatus('error');
                cleanup();
            };

            wsRef.current = ws;

            await startMedia(audioContext, ws, userAnalyser);

        } catch (error) {
            console.error("Connection Failed", error);
            setStatus('error');
        }
    }, [apiKey, systemInstruction]);

    const startMedia = async (context: AudioContext, ws: WebSocket, userAnalyser: AnalyserNode) => {
        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                }
            });
            // Safety check with cast
            if ((context.state as string) === 'closed') {
                audioStream.getTracks().forEach(t => t.stop());
                return;
            }
            audioStreamRef.current = audioStream;

            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 10, max: 15 }
                },
                audio: false
            });
            // Safety check with cast
            if ((context.state as string) === 'closed') {
                audioStream.getTracks().forEach(t => t.stop());
                screenStream.getTracks().forEach(t => t.stop());
                return;
            }
            mediaStreamRef.current = screenStream;
            setVideoStream(screenStream);

            const source = context.createMediaStreamSource(audioStream);
            source.connect(userAnalyser);

            await context.audioWorklet.addModule('/worklets/pcm-processor.js');

            // Safety check before creating worklet with cast
            if ((context.state as string) === 'closed') return;

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

            userAnalyser.connect(worklet);
            audioWorkletNodeRef.current = worklet;
            setIsRecording(true);

            startVideoTransmission(ws, screenStream);

        } catch (err) {
            console.error("Error starting media", err);
            cleanup();
        }
    };

    const startVideoTransmission = (ws: WebSocket, stream: MediaStream) => {
        const videoTrack = stream.getVideoTracks()[0];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.play();

        videoTrack.onended = () => {
            cleanup();
        };

        if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);

        videoIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = 640;
                canvas.height = 360;
                ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

                const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
                const msg = {
                    realtime_input: {
                        media_chunks: [{ mime_type: "image/jpeg", data: base64 }]
                    }
                };
                ws.send(JSON.stringify(msg));
            }
        }, 200);
    };

    const startAnalysisLoop = () => {
        if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);

        analysisIntervalRef.current = setInterval(() => {
            if (userAnalyserRef.current && aiAnalyserRef.current) {
                const userBuffer = new Uint8Array(userAnalyserRef.current.frequencyBinCount);
                const aiBuffer = new Uint8Array(aiAnalyserRef.current.frequencyBinCount);

                userAnalyserRef.current.getByteFrequencyData(userBuffer);
                aiAnalyserRef.current.getByteFrequencyData(aiBuffer);

                const userAvg = userBuffer.reduce((a, b) => a + b, 0) / userBuffer.length;
                const aiAvg = aiBuffer.reduce((a, b) => a + b, 0) / aiBuffer.length;

                setVolumeLevel({ user: userAvg, ai: aiAvg });
            }
        }, 100);
    };

    const cleanup = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        setVideoStream(null);

        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(track => track.stop());
            audioStreamRef.current = null;
        }
        if (videoIntervalRef.current) {
            clearInterval(videoIntervalRef.current);
            videoIntervalRef.current = null;
        }
        if (analysisIntervalRef.current) {
            clearInterval(analysisIntervalRef.current);
            analysisIntervalRef.current = null;
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
    }, []);

    const disconnect = useCallback(() => {
        cleanup();
    }, [cleanup]);

    return { connect, disconnect, status, isRecording, videoStream, volumeLevel, messages };
}
