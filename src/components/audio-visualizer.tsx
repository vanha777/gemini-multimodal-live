import { useRef, useEffect } from 'react';

export const AudioVisualizer = ({ isActive, volume }: { isActive: boolean; volume: number }) => {
    return (
        <div className={`transition-all duration-200 ease-in-out ${isActive ? 'scale-110' : 'scale-100'}`}>
            <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors duration-200 ${isActive ? 'bg-blue-500/20' : 'bg-neutral-800'}`}>
                <div
                    className={`w-full h-full rounded-full bg-blue-500/30 transition-all duration-75`}
                    style={{ transform: `scale(${0.5 + Math.min(volume / 255, 0.5)})` }}
                />
            </div>
        </div>
    );
};
