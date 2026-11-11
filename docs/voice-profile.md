# Voice Profile

The Voice Profile (vault spec PZ-15 to PZ-17), shown on the Hub's My Voice page.

- **Learning:** after each inserted dictation, numbers from its final text are kept for 30
  days (`voice_samples`: words, sentences, commas, full stops, exclamation and question
  marks, capitalised sentence starts, fillers said), plus counts of two-to-four-word phrases
  and the word total (`voice_profiles`, one row). No sentences, no audio.
- **Summary:** after 20 dictations in 30 days, a short summary (sentence length, commas,
  exclamations, frequent phrases) goes to the cleanup model as one line, when "Use it in
  cleanup" is on.
- **Milestones:** 1,000, 10,000 and 50,000 words, each shown once on the Bar with the success
  sound.
- **Prompt:** at most once a week, after a dictation (never during one), the Bar asks to read
  a passage; Yes opens My Voice, which shows one of five passages written for Murmur.
- **My Voice page:** the settings, measures ("Not enough data yet" below 20 dictations),
  frequent phrases, milestones, the passage, recent said/written examples per category, and
  Reset (asks first; deletes all profile rows).

Code: `apps/desktop/src/main/voice/`, `apps/desktop/src/renderer/hub/MyVoicePage.tsx`.
Migration `0008_voice_profile.sql`; settings key `voice_profile.flags`.
