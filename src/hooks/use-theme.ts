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
    danger: getVariable(theme.danger),
    text: getVariable(theme.color),
    textSecondary: getVariable(theme.colorMuted),
  };
}
