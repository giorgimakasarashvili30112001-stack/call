---
name: Call recording platform limits
description: Native and carrier-call constraints that shape future recorder work.
---

The Expo-compatible recorder can capture local microphone audio and persist its native file, but it cannot silently capture regular carrier calls or mix a remote VoIP participant by itself. MP3 output is not a portable native recording guarantee across iOS and Android.

**Why:** iOS restricts third-party carrier-call capture, Android behavior varies by device and policy, and Expo audio presets use platform-native formats.

**How to apply:** Treat live two-sided recording as a separate VoIP/WebRTC/native-audio milestone with explicit consent and a format-conversion/export strategy.