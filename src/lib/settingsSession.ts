export type ClosedSettingsFocus = {
  settingsOpen: false
  focusAppUpdate: false
  focusWatchFolders: false
}

/** Shared Settings dismiss: drop app-update and watch-folder deep-link focus. */
export function closedSettingsFocus(): ClosedSettingsFocus {
  return {
    settingsOpen: false,
    focusAppUpdate: false,
    focusWatchFolders: false,
  }
}

/** Reopen first-run onboarding by dismissing Settings through the same focus cleanup. */
export function startOnboardingFromSettings(): ClosedSettingsFocus & { onboardingOpen: true } {
  return { ...closedSettingsFocus(), onboardingOpen: true }
}
