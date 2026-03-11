import { useEffect, useRef, useCallback } from 'react';
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';

interface UseGlobalHotkeyProps {
  enabled: boolean;
  hotkey: string;
  mode: 'push_to_talk' | 'double_tap';
  doubleTapInterval?: number;
  onPressed?: () => void;
  onReleased?: () => void;
  onToggleRecording?: () => void;
}

export function useGlobalHotkey({
  enabled,
  hotkey,
  mode,
  doubleTapInterval = 400,
  onPressed,
  onReleased,
  onToggleRecording,
}: UseGlobalHotkeyProps) {
  const currentHotkeyRef = useRef<string | null>(null);
  const isKeyDownRef = useRef(false);
  const lastPressTimeRef = useRef(0);
  const doubleTapFiredRef = useRef(false);

  const handleShortcut = useCallback((event: { state: 'Pressed' | 'Released' }) => {
    if (mode === 'push_to_talk') {
      // Push-to-talk: press=start, release=stop
      if (event.state === 'Pressed' && !isKeyDownRef.current) {
        isKeyDownRef.current = true;
        onPressed?.();
      } else if (event.state === 'Released' && isKeyDownRef.current) {
        isKeyDownRef.current = false;
        onReleased?.();
      }
    } else if (mode === 'double_tap') {
      // Double-tap: two Pressed events within threshold toggles recording
      if (event.state === 'Pressed') {
        const now = Date.now();
        const timeSinceLast = now - lastPressTimeRef.current;

        if (timeSinceLast <= doubleTapInterval && !doubleTapFiredRef.current) {
          // Double-tap detected
          doubleTapFiredRef.current = true;
          onToggleRecording?.();
        } else {
          // First tap or reset after double-tap
          doubleTapFiredRef.current = false;
        }

        lastPressTimeRef.current = now;
      }
    }
  }, [mode, doubleTapInterval, onPressed, onReleased, onToggleRecording]);

  useEffect(() => {
    const setupHotkey = async () => {
      // Unregister previous hotkey if different
      if (currentHotkeyRef.current && currentHotkeyRef.current !== hotkey) {
        try {
          const wasRegistered = await isRegistered(currentHotkeyRef.current);
          if (wasRegistered) {
            await unregister(currentHotkeyRef.current);
          }
        } catch (err) {
          console.warn('Failed to unregister previous hotkey:', err);
        }
        currentHotkeyRef.current = null;
      }

      // Register new hotkey if enabled
      if (enabled && hotkey) {
        try {
          const alreadyRegistered = await isRegistered(hotkey);
          if (!alreadyRegistered) {
            await register(hotkey, handleShortcut);
            currentHotkeyRef.current = hotkey;
            console.log('Global hotkey registered:', hotkey);
          }
        } catch (err) {
          console.error('Failed to register global hotkey:', err);
        }
      } else if (!enabled && currentHotkeyRef.current) {
        // Unregister if disabled
        try {
          await unregister(currentHotkeyRef.current);
          currentHotkeyRef.current = null;
          console.log('Global hotkey unregistered');
        } catch (err) {
          console.warn('Failed to unregister hotkey:', err);
        }
      }
    };

    setupHotkey();

    // Cleanup on unmount
    return () => {
      if (currentHotkeyRef.current) {
        unregister(currentHotkeyRef.current).catch((err) => {
          console.warn('Failed to cleanup hotkey on unmount:', err);
        });
      }
    };
  }, [enabled, hotkey, handleShortcut]);

  return {
    isRegistered: currentHotkeyRef.current !== null,
  };
}
