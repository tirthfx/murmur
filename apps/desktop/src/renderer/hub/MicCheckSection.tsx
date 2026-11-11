import { useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { MIC_CHECK_SENTENCES, type MicCheckResult } from "@murmur/shared";

/** -60 dB and below shows as empty, 0 dB as full. */
export function meterPercent(rmsDb: number | null): number {
  if (rmsDb === null) return 0;
  return Math.round(Math.min(100, Math.max(0, ((rmsDb + 60) / 60) * 100)));
}

function decibels(value: number | null): string {
  return value === null ? "nothing heard" : `${Math.round(value)} dB`;
}

/**
 * The microphone check (DC-13): a live level meter and five sentences to read. Nothing is
 * recorded to disk and no history is written; the result is advice only.
 */
export function MicCheckSection() {
  const [state, setState] = useState<"idle" | "running" | "stopping">("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [result, setResult] = useState<MicCheckResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.murmur.onMicCheckLevel((rmsDb) => {
      if (mounted.current) setLevel(rmsDb);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      // Leaving the page ends a running check.
      void window.murmur.micCheckStop().catch(() => {});
    };
  }, []);

  const start = () => {
    setProblem(null);
    setResult(null);
    window.murmur.micCheckStart().then(
      (started) => {
        if (!mounted.current) return;
        if (started.ok) {
          setDeviceName(started.deviceName);
          setState("running");
        } else setProblem(started.message);
      },
      () => mounted.current && setProblem("The microphone check could not start."),
    );
  };

  const stop = () => {
    setState("stopping");
    window.murmur.micCheckStop().then(
      (value) => {
        if (!mounted.current) return;
        setState("idle");
        setLevel(null);
        setResult(value);
      },
      () => {
        if (!mounted.current) return;
        setState("idle");
        setProblem("The microphone check could not finish.");
      },
    );
  };

  return (
    <section className="hub-permissions" aria-labelledby="mic-check-heading">
      <Heading level={2} id="mic-check-heading">
        Microphone check
      </Heading>
      <Text size="sm" color="secondary">
        Read the sentences below at your normal volume. Nothing is saved; you get advice about your
        setup.
      </Text>
      {state === "idle" ? (
        <div>
          <Button variant="secondary" label="Start microphone check" onClick={start}>
            Start microphone check
          </Button>
        </div>
      ) : (
        <VStack gap={3}>
          <Text size="sm">Listening on {deviceName}</Text>
          <div
            className="hub-meter"
            role="meter"
            aria-label="Input level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={meterPercent(level)}
          >
            <div className="hub-meter-fill" style={{ width: `${meterPercent(level)}%` }} />
          </div>
          <ol className="hub-mic-sentences">
            {MIC_CHECK_SENTENCES.map((sentence) => (
              <li key={sentence}>
                <Text>{sentence}</Text>
              </li>
            ))}
          </ol>
          <div>
            <Button
              variant="primary"
              label="Finish microphone check"
              isDisabled={state === "stopping"}
              onClick={stop}
            >
              Finish
            </Button>
          </div>
        </VStack>
      )}
      {result ? (
        <Banner
          status={
            result.advice === "quiet-room" || result.advice === "close-talk" ? "success" : "warning"
          }
          title={result.adviceText}
          description={`Voice ${decibels(result.speechDb)}, background ${decibels(result.noiseDb)}${result.deviceName ? `, on ${result.deviceName}` : ""}.`}
        />
      ) : null}
      {problem ? <Banner status="error" title={problem} /> : null}
    </section>
  );
}
