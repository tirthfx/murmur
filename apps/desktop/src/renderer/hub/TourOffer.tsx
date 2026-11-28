import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { Tour } from "@murmur/shared";

/** HB-08: offers a page's tour the first time it is opened. Answering either way ends the offer. */
export function TourOffer({
  tour,
  onStart,
  onDismiss,
}: {
  tour: Tour;
  onStart: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside className="hub-tour-offer" aria-label="Tour on offer">
      <VStack gap={2}>
        <Text weight="semibold">New here? {tour.title}</Text>
        <Text size="sm" color="secondary">
          {tour.summary}
        </Text>
        <HStack gap={2}>
          <Button
            size="sm"
            variant="primary"
            label={`Take the tour: ${tour.title}`}
            onClick={onStart}
          >
            Show me
          </Button>
          <Button size="sm" variant="ghost" label="Not now" onClick={onDismiss}>
            Not now
          </Button>
        </HStack>
      </VStack>
    </aside>
  );
}
