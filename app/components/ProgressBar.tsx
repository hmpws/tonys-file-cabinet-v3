import { useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";

export function ProgressBar() {
    const navigation = useNavigation();
    const active = navigation.state !== "idle";

    const [progress, setProgress] = useState(0);
    const [visible, setVisible] = useState(false);
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        if (active) {
            setVisible(true);
            setProgress(0);

            // Start the progress animation
            const animate = () => {
                setProgress((oldProgress) => {
                    // Trickle logic: fast at first, then slows down, never reaching 100% until finished
                    let step = 0;
                    if (oldProgress < 20) step = 5;
                    else if (oldProgress < 50) step = 2;
                    else if (oldProgress < 80) step = 0.5;
                    else if (oldProgress < 95) step = 0.1;

                    const newProgress = oldProgress + step;
                    return Math.min(newProgress, 95); // Cap at 95% while loading
                });
                animationFrameId.current = requestAnimationFrame(animate);
            };

            animationFrameId.current = requestAnimationFrame(animate);

        } else {
            // When navigation finishes
            cancelAnimationFrame(animationFrameId.current);
            setProgress(100); // Jump to complete

            // Hide after a short delay
            const timeout = setTimeout(() => {
                setVisible(false);
                setProgress(0);
            }, 200); // 200ms delay to show completion

            return () => clearTimeout(timeout);
        }

        return () => cancelAnimationFrame(animationFrameId.current);
    }, [active]);

    if (!visible) return null;

    return (
        <div className="fixed top-0 left-0 right-0 h-1 z-[9999] pointer-events-none">
            <div
                className="h-full bg-blue-600 transition-all duration-200 ease-out"
                style={{ width: `${progress}%` }}
            />
        </div>
    );
}
