import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  EMAIL_LANGUAGES,
  EMAIL_LIMITS,
  formatKb,
  withSignature,
  type EmailLanguage,
  type EmailSettings,
  type WritingSample,
} from "@murmur/shared";

const SAME = "same";
const LANGUAGE_OPTIONS = [
  { value: SAME, label: "Same as dictation" },
  ...EMAIL_LANGUAGES.map((language) => ({ value: language.code, label: language.label })),
];

/**
 * A file's text, or why it cannot be a sample: too large, or not plain UTF-8 text (PZ-20).
 * The size is checked before the file is read.
 */
export async function readSampleFile(
  file: Pick<File, "size" | "arrayBuffer">,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  if (file.size > EMAIL_LIMITS.sampleBytes) {
    return {
      ok: false,
      message: `The file is ${formatKb(file.size)}; samples can be up to ${formatKb(EMAIL_LIMITS.sampleBytes)}.`,
    };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (text.includes("\u0000")) throw new Error("binary");
    return { ok: true, text };
  } catch {
    return { ok: false, message: "Only plain text files (UTF-8) can be used as samples." };
  }
}

/** Email on the Styles page (PZ-20 to PZ-23): signature, email language, writing samples. */
export function EmailSection() {
  const [email, setEmail] = useState<EmailSettings | null>(null);
  const [signature, setSignature] = useState("");
  const [samples, setSamples] = useState<WritingSample[]>([]);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ status: "success" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    window.murmur.getSettings().then(
      (view) => {
        setEmail(view.settings.email);
        setSignature(view.settings.email.signature);
      },
      () => setEmail(null),
    );
    window.murmur.writingSamplesList().then(setSamples, () => setSamples([]));
  }, []);

  async function update(patch: Partial<EmailSettings>) {
    if (!email) return;
    const next = await window.murmur.updateSettings({ email: { ...email, ...patch } });
    setEmail(next.settings.email);
    setSignature(next.settings.email.signature);
  }

  async function addSample(sampleText: string, sampleLabel: string) {
    const result = await window.murmur.writingSamplesSave({ label: sampleLabel, text: sampleText });
    if (!result.ok) {
      setMessage({ status: "error", text: result.message });
      return;
    }
    setSamples(await window.murmur.writingSamplesList());
    setLabel("");
    setText("");
    setMessage({ status: "success", text: `Saved “${result.sample.label}”.` });
  }

  async function chooseFile(file: File | undefined) {
    setMessage(null);
    if (!file) return;
    const read = await readSampleFile(file);
    if (!read.ok) {
      setMessage({ status: "error", text: read.message });
      return;
    }
    await addSample(read.text, label.trim() || file.name.replace(/\.[^.]+$/, ""));
  }

  const full = samples.length >= EMAIL_LIMITS.samples;
  return (
    <section aria-labelledby="email-heading">
      <VStack gap={3}>
        <VStack gap={0}>
          <Heading level={2} id="email-heading">
            Email signature and language
          </Heading>
          <Text size="sm" color="secondary">
            Used in mail apps and webmail pages only (the Email category).
          </Text>
        </VStack>

        {email ? (
          <VStack gap={2}>
            <TextArea
              label="Signature"
              description={`Added after a blank line, never sent to the model. Up to ${EMAIL_LIMITS.signatureChars} characters.`}
              rows={3}
              value={signature}
              onChange={(value) => setSignature(value.slice(0, EMAIL_LIMITS.signatureChars))}
            />
            {signature.trim() !== "" ? (
              <Text size="sm" color="secondary" data-testid="signature-preview">
                Example: {withSignature("See you on Friday.", signature)}
              </Text>
            ) : null}
            <div>
              <Button
                size="sm"
                variant="secondary"
                label="Save signature"
                isDisabled={signature === email.signature}
                onClick={() => void update({ signature })}
              >
                Save signature
              </Button>
            </div>
            <Switch
              label="Add to new messages"
              value={email.addToNew}
              onChange={(addToNew) => void update({ addToNew })}
            />
            <Switch
              label="Add to replies"
              description="A reply is a window whose title starts with “Re:”."
              value={email.addToReplies}
              onChange={(addToReplies) => void update({ addToReplies })}
            />
            <Selector
              label="Email language"
              description="Email text in another language is translated by the local model after cleanup. Names, numbers and links stay as they are. If it takes longer than 6 seconds, the text goes in as dictated."
              options={LANGUAGE_OPTIONS}
              value={email.language ?? SAME}
              onChange={(value) =>
                void update({ language: value === SAME ? null : (value as EmailLanguage) })
              }
            />
          </VStack>
        ) : (
          <Banner status="error" title="Email settings could not be read." />
        )}

        <section aria-labelledby="samples-heading">
          <VStack gap={2}>
            <Heading level={3} id="samples-heading">
              Writing samples
            </Heading>
            <Text size="sm" color="secondary">
              Examples of your own writing, for Rewrites to match your style. Not used when cleaning
              up dictation. Up to {EMAIL_LIMITS.samples} samples,{" "}
              {formatKb(EMAIL_LIMITS.sampleBytes)} each, plain text only.
            </Text>
            {samples.length > 0 ? (
              <ul className="hub-dictionary-list" aria-label="Writing samples">
                {samples.map((sample) => (
                  <li key={sample.id}>
                    <HStack gap={2} align="center">
                      <Text>
                        {sample.label} · {formatKb(sample.bytes)}
                      </Text>
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Delete sample ${sample.label}`}
                        onClick={async () => {
                          await window.murmur.writingSamplesDelete(sample.id);
                          setSamples(await window.murmur.writingSamplesList());
                        }}
                      >
                        Delete
                      </Button>
                    </HStack>
                  </li>
                ))}
              </ul>
            ) : (
              <Text size="sm" color="secondary">
                No samples yet.
              </Text>
            )}
            {full ? (
              <Text size="sm" color="secondary">
                {EMAIL_LIMITS.samples} samples saved. Delete one to add another.
              </Text>
            ) : (
              <VStack gap={2}>
                <TextInput
                  label="Sample label"
                  description="For example “Work email” or “Newsletter draft”."
                  value={label}
                  onChange={(value) => setLabel(value.slice(0, EMAIL_LIMITS.labelChars))}
                />
                <TextArea
                  label="Sample text"
                  description="Paste text, or choose a plain text file below."
                  rows={4}
                  value={text}
                  onChange={setText}
                />
                <HStack gap={2} align="center">
                  <Button
                    size="sm"
                    label="Save sample"
                    isDisabled={label.trim() === "" || text.trim() === ""}
                    onClick={() => void addSample(text, label)}
                  >
                    Save sample
                  </Button>
                  <input
                    type="file"
                    accept=".txt,.md,.markdown,text/plain"
                    aria-label="Choose a text file as a writing sample"
                    onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
                  />
                </HStack>
              </VStack>
            )}
            {message ? <Banner status={message.status} title={message.text} /> : null}
          </VStack>
        </section>
      </VStack>
    </section>
  );
}
