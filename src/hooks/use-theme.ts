/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { getVariable, useTheme as useTamaguiTheme } from 'tamagui';

export function useTheme() {
  const theme = useTamaguiTheme();

  return {
    background: getVariable(theme.background),
    backgroundElement: getVariable(theme.backgroundElement),
    backgroundSelected: getVariable(theme.backgroundSelected),
    borderColor: getVariable(theme.borderColor),
    accent: getVariable(theme.accent),
    accentForeground: getVariable(theme.accentForeground),
    accentSubtle: getVariable(theme.accentSubtle),
    danger: getVariable(theme.danger),
    success: getVariable(theme.success),
    warning: getVariable(theme.warning),
    text: getVariable(theme.color),
    textSecondary: getVariable(theme.colorMuted),
  };
}
