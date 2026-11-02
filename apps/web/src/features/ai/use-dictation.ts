import { useEffect, useRef, useState } from 'react';

export interface Dictation {
  /** False where the browser has no speech recognition (Firefox): the button is not rendered. */
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
  /** Readable reason the last attempt ended early ("Microphone access was denied."), else null. */
  error: string | null;
}

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function describeError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was denied. Type the meal instead.';
    case 'no-speech':
      return 'No speech was heard. Tap the microphone and try again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Speech recognition needs a network connection.';
    default:
      return 'Dictation stopped unexpectedly. Type the meal instead.';
  }
}

/**
 * One-shot dictation into the meal description (DESIGN: "say what you ate"). Each tap records one
 * utterance in the device language and appends the final transcript through `onText`; the
 * browser's own recogniser does the work, nothing is sent to Plate's server until Analyse.
 */
export function useDictation(onText: (text: string) => void): Dictation {
  const Recognition = recognitionConstructor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<SpeechRecognitionLike | null>(null);

  // Stop the recogniser when the sheet unmounts mid-utterance.
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  const stop = () => {
    active.current?.stop();
  };

  // `onText` is captured when dictation starts; callers pass a functional state update, so the
  // transcript lands on the text as it is when it arrives.
  const start = () => {
    if (!Recognition || active.current) return;
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal && result[0]) parts.push(result[0].transcript);
      }
      const text = parts.join(' ').trim();
      if (text) onText(text);
    };
    recognition.onerror = (event) => {
      // "aborted" is the user's own stop (or the unmount), not a failure.
      if (event.error !== 'aborted') setError(describeError(event.error));
    };
    recognition.onend = () => {
      active.current = null;
      setListening(false);
    };
    active.current = recognition;
    setError(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      active.current = null;
      setListening(false);
      setError(describeError('unknown'));
    }
  };

  return { supported: Recognition !== null, listening, start, stop, error };
}
