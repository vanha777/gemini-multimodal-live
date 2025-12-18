"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useGeminiLive } from '@/hooks/use-gemini-live';
import { Mic, MicOff, Loader2, Video } from 'lucide-react';
import clsx from 'clsx';
import { AudioVisualizer } from './audio-visualizer';

export default function LiveInterface({ defaultApiKey = '' }: { defaultApiKey?: string }) {
    const [apiKey, setApiKey] = useState(defaultApiKey);
    const { connect, disconnect, status, isRecording, videoStream, volumeLevel } = useGeminiLive({ apiKey });
    const [isClient, setIsClient] = useState(false);

    // Video Ref for Local Feed
    const videoRef = useRef<HTMLVideoElement>(null);

    React.useEffect(() => {
        setIsClient(true);
        if (defaultApiKey) return;
        const stored = localStorage.getItem('gemini_api_key');
        if (stored) setApiKey(stored);
    }, [defaultApiKey]);

    // Attach stream to video element
    useEffect(() => {
        if (videoRef.current && videoStream) {
            videoRef.current.srcObject = videoStream;
        }
    }, [videoStream]);

    const handleStart = () => {
        if (!apiKey) {
            alert("Please enter a valid API Key");
            return;
        }
        localStorage.setItem('gemini_api_key', apiKey);
        connect();
    };

    const handleStop = () => {
        disconnect();
    };

    if (!isClient) return null;

    return (
        <div className="flex flex-col h-screen bg-neutral-950 text-white overflow-hidden font-sans">
            {/* Header */}
            <header className="flex-none p-6 border-b border-neutral-800 flex justify-between items-center z-10 bg-neutral-950">
                <div>
                    <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Gemini Live</h1>
                    <span className={clsx("text-xs font-mono uppercase px-2 py-0.5 rounded-full mt-1 inline-block",
                        status === 'connected' ? "bg-green-500/20 text-green-400" :
                            status === 'connecting' ? "bg-yellow-500/20 text-yellow-400" :
                                "bg-neutral-800 text-neutral-500"
                    )}>
                        {status}
                    </span>
                </div>

                {/* API Key Input (Mini) */}
                <div className="flex items-center gap-2">
                    {!defaultApiKey && (
                        <input
                            type="password"
                            className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none w-48 text-neutral-400"
                            placeholder="API Key"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            disabled={status === 'connected'}
                        />
                    )}

                    {status === 'connected' ? (
                        <button
                            onClick={handleStop}
                            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            <MicOff size={16} /> Disconnect
                        </button>
                    ) : (
                        <button
                            onClick={handleStart}
                            disabled={!apiKey || status === 'connecting'}
                            className={clsx("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-[0_0_15px_rgba(59,130,246,0.2)]",
                                !apiKey || status === 'connecting' ? "bg-neutral-800 text-neutral-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white"
                            )}
                        >
                            {status === 'connecting' ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                            Start Session
                        </button>
                    )}
                </div>
            </header>

            {/* Main Split Layout */}
            <main className="flex-1 flex flex-col md:flex-row p-4 gap-4 overflow-hidden relative">

                {/* Left Column: User Video Feed */}
                <div className={clsx("relative flex-1 bg-neutral-900/50 rounded-2xl overflow-hidden border transition-all duration-300",
                    volumeLevel.user > 20 ? "border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.15)]" : "border-neutral-800"
                )}>
                    {videoStream ? (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover scale-x-[-1]" // Mirror effect
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-neutral-600 gap-4">
                            <div className="w-16 h-16 rounded-full bg-neutral-800 flex items-center justify-center">
                                <Video size={32} />
                            </div>
                            <p className="text-sm font-medium">Camera Off</p>
                        </div>
                    )}

                    {/* Speaker Label */}
                    <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2">
                        <div className={clsx("w-2 h-2 rounded-full", volumeLevel.user > 10 ? "bg-green-500" : "bg-neutral-500")} />
                        <span className="text-xs font-medium text-white">You</span>
                    </div>

                    {/* Audio Vis over video (optional) */}
                    <div className="absolute bottom-4 right-4">
                        <AudioVisualizer isActive={volumeLevel.user > 10} volume={volumeLevel.user} />
                    </div>
                </div>

                {/* Right Column: AI / Conversation Context */}
                <div className={clsx("relative flex-1 bg-neutral-900/50 rounded-2xl overflow-hidden border transition-all duration-300 flex flex-col items-center justify-center relative",
                    volumeLevel.ai > 20 ? "border-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.15)]" : "border-neutral-800"
                )}>

                    {/* Gemini Logo / Visualization */}
                    <div className="relative z-10">
                        <div className={clsx("w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300",
                            status === 'connected' ? "bg-gradient-to-tr from-blue-600 to-purple-600 shadow-[0_0_50px_rgba(147,51,234,0.3)]" : "bg-neutral-800"
                        )}>
                            <img src="/next.svg" className="w-12 h-12 opacity-50 invert" alt="Gemini" />
                            {/* Simple ripple efffect */}
                            {status === 'connected' && (
                                <>
                                    <div className="absolute inset-0 border-2 border-white/20 rounded-full animate-ping" style={{ animationDuration: '2s' }} />
                                    <div className="absolute inset-0 border border-white/10 rounded-full animate-ping" style={{ animationDuration: '1.5s', animationDelay: '0.2s' }} />
                                </>
                            )}
                        </div>
                    </div>

                    <div className="mt-8 text-center space-y-2">
                        <h2 className="text-xl font-medium text-white">Gemini</h2>
                        <p className={clsx("text-sm transition-colors", status === 'connected' ? "text-purple-400" : "text-neutral-500")}>
                            {status === 'connected' ? (volumeLevel.ai > 10 ? "Speaking..." : "Listening...") : "Idle"}
                        </p>
                    </div>

                    {/* AI Speaker Label */}
                    <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2">
                        <div className={clsx("w-2 h-2 rounded-full", volumeLevel.ai > 10 ? "bg-purple-500" : "bg-neutral-500")} />
                        <span className="text-xs font-medium text-white">Gemini 2.0 Flash Live</span>
                    </div>

                    {/* Audio Vis for AI */}
                    <div className="absolute bottom-4 right-4">
                        <AudioVisualizer isActive={volumeLevel.ai > 10} volume={volumeLevel.ai} />
                    </div>

                </div>

            </main>
        </div>
    );
}
