---
name: Expo config plugins with pnpm
description: Custom Expo config plugins must declare their config-plugin runtime directly in the app package.
---

With pnpm's isolated node linker, a local Expo config plugin cannot rely on `@expo/config-plugins` being available transitively through Expo. The app package must declare it directly, using the version aligned with the Expo SDK.

**Why:** Expo evaluates local config plugins from the app workspace during native builds, and pnpm does not expose undeclared transitive dependencies through the app's module resolution path.

**How to apply:** When adding or maintaining a local Expo config plugin, add the matching `@expo/config-plugins` version to that Expo app's dependencies or devDependencies and regenerate the lockfile before building native Android or iOS projects.