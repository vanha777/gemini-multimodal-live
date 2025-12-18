"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useGeminiLive, Message } from '@/hooks/use-gemini-live';
import { Mic, MicOff, Loader2, Monitor, Settings } from 'lucide-react';
import clsx from 'clsx';
import { AudioVisualizer } from './audio-visualizer';

export default function LiveInterface({ defaultApiKey = '' }: { defaultApiKey?: string }) {
    const [apiKey, setApiKey] = useState(defaultApiKey);
    const [systemInstruction, setSystemInstruction] = useState("You are a helpful AI assistant. You can see the user's screen and hear them. Respond concisely.");
    const [showSettings, setShowSettings] = useState(false);

    // Pass systemInstruction to hook
    const { connect, disconnect, status, isRecording, videoStream, volumeLevel, messages } = useGeminiLive({ apiKey, systemInstruction });

    const [isClient, setIsClient] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

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

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
            <header className="flex-none p-4 border-b border-neutral-800 flex justify-between items-center z-10 bg-neutral-950/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold tracking-tighter bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Gemini Live</h1>
                    <span className={clsx("text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border",
                        status === 'connected' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            status === 'connecting' ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                                "bg-neutral-800 text-neutral-500 border-neutral-700"
                    )}>
                        {status}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={clsx("p-2 rounded-lg transition-colors", showSettings ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white")}
                        disabled={status === 'connected'}
                    >
                        <Settings size={18} />
                    </button>

                    {!defaultApiKey && (
                        <input
                            type="password"
                            className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none w-32 text-neutral-400"
                            placeholder="API Key"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            disabled={status === 'connected'}
                        />
                    )}

                    {status === 'connected' ? (
                        <button
                            onClick={handleStop}
                            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                        >
                            <MicOff size={16} /> End
                        </button>
                    ) : (
                        <button
                            onClick={handleStart}
                            disabled={!apiKey || status === 'connecting'}
                            className={clsx("flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all shadow-[0_0_15px_rgba(59,130,246,0.2)]",
                                !apiKey || status === 'connecting' ? "bg-neutral-800 text-neutral-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white"
                            )}
                        >
                            {status === 'connecting' ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                            Start
                        </button>
                    )}
                </div>
            </header>

            {/* Settings Overlay */}
            {showSettings && (
                <div className="bg-neutral-900 border-b border-neutral-800 p-4 animate-in slide-in-from-top-2">
                    <label className="block text-xs font-medium text-neutral-500 mb-2 uppercase tracking-wider">System Instruction</label>
                    <textarea
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none h-24 resize-none text-neutral-300"
                        value={systemInstruction}
                        onChange={(e) => setSystemInstruction(e.target.value)}
                        placeholder="Tell Gemini how to behave..."
                    />
                </div>
            )}

            {/* Main Split Layout */}
            <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">

                {/* Left Column: Screen Share Feed */}
                <div className="flex-1 bg-neutral-900/50 relative flex flex-col border-r border-neutral-800">
                    <div className={clsx("absolute inset-0 transition-all duration-300 pointer-events-none border-4 z-10",
                        volumeLevel.user > 20 ? "border-blue-500/50" : "border-transparent"
                    )} />

                    {videoStream ? (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-contain bg-black"
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-neutral-600 gap-4 bg-neutral-950/50">
                            <div className="w-20 h-20 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                                <Monitor size={40} />
                            </div>
                            <p className="text-sm font-medium">Ready to Share Screen</p>
                        </div>
                    )}

                    {/* Info Overlay */}
                    <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2 z-20">
                        <div className={clsx("w-2 h-2 rounded-full", volumeLevel.user > 10 ? "bg-green-500" : "bg-neutral-500")} />
                        <span className="text-xs font-medium text-white">Your Screen & Mic</span>
                        <AudioVisualizer isActive={volumeLevel.user > 10} volume={volumeLevel.user} />
                    </div>
                </div>

                {/* Right Column: Chat Transcript & AI State */}
                <div className={clsx("md:w-[400px] flex-none bg-neutral-950 flex flex-col relative transition-all duration-300 border-l border-neutral-800",
                    volumeLevel.ai > 20 ? "shadow-[inset_0_0_30px_rgba(168,85,247,0.1)]" : ""
                )}>

                    {/* Visualizer Header */}
                    <div className="h-32 flex-none border-b border-neutral-800 flex flex-col items-center justify-center bg-neutral-900/20 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-b from-purple-500/5 to-transparent" />

                        <div className={clsx("w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 relative z-10",
                            status === 'connected' ? "bg-purple-600 shadow-[0_0_40px_rgba(147,51,234,0.4)]" : "bg-neutral-800"
                        )}>
                            <img src="/next.svg" className="w-8 h-8 opacity-50 invert" alt="Gemini" />
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                            <AudioVisualizer isActive={volumeLevel.ai > 10} volume={volumeLevel.ai} />
                            <span className={clsx("text-xs font-medium transition-colors", status === 'connected' ? "text-purple-400" : "text-neutral-500")}>
                                {status === 'connected' ? (volumeLevel.ai > 10 ? "Speaking..." : "Listening...") : "Idle"}
                            </span>
                        </div>
                    </div>

                    {/* Chat Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-neutral-600 opacity-50">
                                <p className="text-sm">Conversation history will appear here</p>
                            </div>
                        )}
                        {messages.map((msg, idx) => (
                            <div key={idx} className={clsx("flex flex-col gap-1 max-w-[90%]",
                                msg.role === 'user' ? "self-end items-end" : "self-start items-start"
                            )}>
                                <span className="text-[10px] uppercase text-neutral-500 font-medium ml-1">
                                    {msg.role === 'model' ? 'Gemini' : 'You'}
                                </span>
                                <div className={clsx("px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm",
                                    msg.role === 'user'
                                        ? "bg-blue-600/20 text-blue-100 rounded-tr-sm border border-blue-500/20"
                                        : "bg-neutral-800 text-neutral-200 rounded-tl-sm border border-neutral-700"
                                )}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>
                </div>

            </main>
        </div>
    );
}
