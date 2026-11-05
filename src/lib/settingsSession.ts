export type ClosedSettingsFocus = {
  settingsOpen: false
  focusAppUpdate: false
  focusWatchFolders: false
  focusFinderSync: false
}

/** Shared Settings dismiss: drop app-update, watch-folder, and Finder Sync deep-link focus. */
export function closedSettingsFocus(): ClosedSettingsFocus {
  return {
    settingsOpen: false,
    focusAppUpdate: false,
    focusWatchFolders: false,
    focusFinderSync: false,
  }
}

/** Reopen first-run onboarding by dismissing Settings through the same focus cleanup. */
export function startOnboardingFromSettings(): ClosedSettingsFocus & { onboardingOpen: true } {
  return { ...closedSettingsFocus(), onboardingOpen: true }
}
