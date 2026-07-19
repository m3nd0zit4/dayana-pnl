"use client";

import { useTheme } from "next-themes";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { THEME_PREFERENCE_OPTIONS } from "@/lib/profile-options";

/**
 * Local UI toggle only — persists via next-themes (localStorage). The DB
 * `themePreference` field is saved separately as part of the profile form
 * submit so the server can seed the initial theme on next login.
 *
 * `theme` reads as undefined until next-themes' own effect resolves it after
 * mount, matching this component's first client render to its SSR output —
 * no local mounted-guard state needed (and none should be added: it would
 * just reintroduce a same-render setState-after-mount pattern).
 */
const AppearanceThemeToggle = () => {
  const { theme, setTheme } = useTheme();

  return (
    <Tabs value={theme ?? "system"} onValueChange={setTheme}>
      <TabsList aria-label="Apariencia">
        {THEME_PREFERENCE_OPTIONS.map((opt) => (
          <TabsTrigger key={opt.value} value={opt.value}>
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};

export default AppearanceThemeToggle;
