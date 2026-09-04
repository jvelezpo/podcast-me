import { Button, styled } from 'tamagui';

export const AppButton = styled(Button, {
  name: 'AppButton',
  unstyled: true,
  minHeight: 44,
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  gap: 8,
  paddingHorizontal: 18,
  paddingVertical: 10,
  borderWidth: 1,
  borderRadius: 999,
  borderColor: '$borderColor',
  backgroundColor: '$accent',
  cursor: 'pointer',
  pressStyle: {
    opacity: 0.88,
    scale: 0.97,
  },
  focusVisibleStyle: {
    outlineColor: '$accent',
    outlineStyle: 'solid',
    outlineWidth: 2,
  },
  disabledStyle: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },

  variants: {
    tone: {
      solid: {
        backgroundColor: '$accent',
        borderColor: '$accent',
      },
      secondary: {
        backgroundColor: '$backgroundSelected',
        borderColor: '$backgroundSelected',
      },
      outlined: {
        backgroundColor: 'transparent',
      },
      danger: {
        backgroundColor: '$backgroundSelected',
        borderColor: '$danger',
      },
      ghost: {
        minHeight: 36,
        backgroundColor: 'transparent',
        borderWidth: 0,
        paddingHorizontal: 8,
      },
      icon: {
        width: 44,
        minWidth: 44,
        height: 44,
        minHeight: 44,
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderWidth: 0,
        backgroundColor: '$backgroundSelected',
      },
      player: {
        width: 68,
        minWidth: 68,
        height: 68,
        minHeight: 68,
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderWidth: 0,
        backgroundColor: '$accent',
      },
    },
  } as const,

  defaultVariants: {
    tone: 'solid',
  },
});
