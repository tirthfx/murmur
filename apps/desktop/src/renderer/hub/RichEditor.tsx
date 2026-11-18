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
  /**
   * Images pasted, dropped or chosen (HB-30). `insert` puts HTML at the cursor and reports
   * the change. Without it, images are not taken.
   */
  onImageFiles?: (files: File[], insert: (html: string) => void) => void;
  /** Loads a stored image's data URL when a document with images is shown. */
  resolveImage?: (id: string) => Promise<string | null>;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/heic", "image/heif", "image/gif"];

/** A small rich-text box: bold, italic, underline, lists and links. */
export function RichEditor({
  loadKey,
  initialHtml,
  onInput,
  label = "Text it inserts",
  testId = "snippet-editor",
  className = "hub-rich-editor",
  onImageFiles,
  resolveImage,
}: EditorProps) {
  const box = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");

  useEffect(() => {
    if (box.current) box.current.innerHTML = initialHtml;
    // Stored images arrive as ids; their pictures are loaded now.
    if (box.current && resolveImage) {
      for (const img of box.current.querySelectorAll<HTMLImageElement>("img[data-image-id]")) {
        const id = img.getAttribute("data-image-id") ?? "";
        void resolveImage(id).then((url) => {
          if (url) img.src = url;
          else img.alt = "Image not found";
        });
      }
    }
    // Only when a different snippet is loaded; typing must not reset the box.
  }, [loadKey]);

  const insert = (html: string) => {
    const root = box.current;
    if (!root) return;
    root.focus();
    // At the cursor; if the browser cannot, at the end.
    const placed =
      typeof document.execCommand === "function" && document.execCommand("insertHTML", false, html);
    if (!placed) root.insertAdjacentHTML("beforeend", html);
    onInput(root);
  };

  const takeImages = (files: FileList | null | undefined): boolean => {
    if (!onImageFiles || !files) return false;
    const images = [...files].filter((file) => IMAGE_TYPES.includes(file.type));
    if (images.length === 0) return false;
    onImageFiles(images, insert);
    return true;
  };

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
        {onImageFiles ? (
          <>
            <input
              ref={picker}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              hidden
              data-testid="image-picker"
              onChange={(event) => {
                takeImages(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              label="Add an image"
              onClick={() => picker.current?.click()}
            >
              Image
            </Button>
          </>
        ) : null}
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
        onPaste={(event) => {
          if (takeImages(event.clipboardData?.files)) event.preventDefault();
        }}
        onDrop={(event) => {
          if (takeImages(event.dataTransfer?.files)) event.preventDefault();
        }}
      />
    </VStack>
  );
}
