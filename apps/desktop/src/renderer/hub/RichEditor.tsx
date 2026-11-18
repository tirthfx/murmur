import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

/** Formatting commands of the editor. `execCommand` is what contentEditable offers. */
function format(command: string, value?: string) {
  document.execCommand(command, false, value);
}

interface EditorProps {
  /** Changes when a different document is loaded, so the box is refilled. */
  loadKey: string;
  initialHtml: string;
  onInput: (root: HTMLElement) => void;
  /** The label above the box. */
  label?: string;
  testId?: string;
  className?: string;
}

/** A small rich-text box: bold, italic, underline, lists and links. */
export function RichEditor({
  loadKey,
  initialHtml,
  onInput,
  label = "Text it inserts",
  testId = "snippet-editor",
  className = "hub-rich-editor",
}: EditorProps) {
  const box = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const [link, setLink] = useState("");

  useEffect(() => {
    if (box.current) box.current.innerHTML = initialHtml;
    // Only when a different snippet is loaded; typing must not reset the box.
  }, [loadKey]);

  const run = (command: string, value?: string) => {
    box.current?.focus();
    format(command, value);
    if (box.current) onInput(box.current);
  };

  return (
    <VStack gap={1}>
      <Text weight="semibold" id={labelId}>
        {label}
      </Text>
      <HStack gap={1} wrap="wrap" align="end" role="toolbar" aria-label="Formatting">
        <Button size="sm" variant="secondary" label="Bold" onClick={() => run("bold")}>
          Bold
        </Button>
        <Button size="sm" variant="secondary" label="Italic" onClick={() => run("italic")}>
          Italic
        </Button>
        <Button size="sm" variant="secondary" label="Underline" onClick={() => run("underline")}>
          Underline
        </Button>
        <Button
          size="sm"
          variant="secondary"
          label="Bulleted list"
          onClick={() => run("insertUnorderedList")}
        >
          Bullets
        </Button>
        <Button
          size="sm"
          variant="secondary"
          label="Numbered list"
          onClick={() => run("insertOrderedList")}
        >
          Numbers
        </Button>
        <TextInput
          label="Link address"
          size="sm"
          value={link}
          onChange={setLink}
          placeholder="https://"
        />
        <Button
          size="sm"
          variant="secondary"
          label="Link the selected text"
          isDisabled={!/^(https?:|mailto:)/i.test(link.trim())}
          onClick={() => {
            run("createLink", link.trim());
            setLink("");
          }}
        >
          Link
        </Button>
      </HStack>
      <div
        ref={box}
        className={className}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        data-testid={testId}
        suppressContentEditableWarning
        onInput={(event) => onInput(event.currentTarget)}
      />
    </VStack>
  );
}
