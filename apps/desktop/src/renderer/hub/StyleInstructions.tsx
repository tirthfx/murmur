import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import {
  CATEGORY_LABELS,
  STYLE_INSTRUCTIONS_MAX,
  type Style,
  type StylesView,
} from "@murmur/shared";

function Instructions({
  style,
  onSave,
}: {
  style: Style;
  onSave: (instructions: string) => Promise<void>;
}) {
  const [text, setText] = useState(style.instructions);
  const label = CATEGORY_LABELS[style.category];
  return (
    <VStack gap={1}>
      <TextArea
        label={`Your own instructions for ${label}`}
        rows={2}
        value={text}
        onChange={(value) => setText(value.slice(0, STYLE_INSTRUCTIONS_MAX))}
      />
      <div>
        <Button
          size="sm"
          variant="secondary"
          label={`Save ${label} instructions`}
          isDisabled={text === style.instructions}
          onClick={() => void onSave(text)}
        >
          Save instructions
        </Button>
      </div>
    </VStack>
  );
}

/** HB-09: the same instructions as on the Styles page, editable beside the Voice Profile. */
export function StyleInstructions() {
  const [view, setView] = useState<StylesView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    window.murmur.stylesView().then(
      (found) => alive && setView(found),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  async function save(style: Style, instructions: string) {
    try {
      setView(
        await window.murmur.stylesUpdate({
          category: style.category,
          preset: style.preset,
          instructions,
        }),
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  if (!view) return failed ? <Banner status="error" title="Styles could not be read." /> : null;
  return (
    <VStack gap={3}>
      <Heading level={2}>Style instructions</Heading>
      {failed ? <Banner status="error" title="That change could not be saved." /> : null}
      {view.styles.map((style) => (
        <Instructions
          key={style.id}
          style={style}
          onSave={(instructions) => save(style, instructions)}
        />
      ))}
    </VStack>
  );
}
