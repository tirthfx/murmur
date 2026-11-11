# Typing reminder

When you type a lot without dictating, the Bar suggests dictating instead: "Dictate instead?
Hold Right Option." (with your own push-to-talk key).

## When it shows

- More than 60 words typed within a rolling two minutes.
- At most once an hour.
- Never while a dictation is recording or being processed.

## What is counted

The helper counts words from key presses alone: a key that types something starts a word,
and space, return or tab ends it. Shortcuts (Command or Control held), editing keys and
arrows do not count. **No character is read, kept or sent**; only the number of words
leaves the helper, every 30 seconds and only when it is above zero (`typing.activity`).
Counting runs only while the reminder is on and not snoozed (`typing.watch`), and only while
the key listener runs. Counts live in memory.

Password fields and other secure input never reach the key listener at all.

## Snooze

Tray menu, **Typing reminder**: Snooze for 1 hour, Snooze until tomorrow (09:00 local time),
Turn off, and Turn on or Resume now. Settings has the same on and off switch. The snooze is
stored in settings (`reminder.typing`), so it survives a restart.

## Manual test

1. Type about 70 words in TextEdit within two minutes. Within 30 seconds the Bar shows the
   suggestion.
2. Keep typing: nothing more for an hour.
3. Choose Snooze for 1 hour in the tray, quit and start Murmur again: the tray still says
   Snoozed.
