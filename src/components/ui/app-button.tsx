import { Button, styled } from 'tamagui';

export const AppButton = styled(Button, {
  name: 'AppButton',
  unstyled: true,
  minHeight: 44,
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  gap: 8,
  paddingHorizontal: 16,
  paddingVertical: 8,
  borderWidth: 1,
  borderRadius: 16,
  borderColor: '$borderColor',
  backgroundColor: '$backgroundSelected',
  cursor: 'pointer',
  pressStyle: {
    opacity: 0.72,
    scale: 0.98,
  },
  focusVisibleStyle: {
    outlineColor: '$color',
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
        backgroundColor: '$backgroundSelected',
      },
      outlined: {
        backgroundColor: 'transparent',
      },
      danger: {
        backgroundColor: 'transparent',
        borderColor: '$danger',
      },
      ghost: {
        minHeight: 36,
        backgroundColor: 'transparent',
        borderWidth: 0,
        paddingHorizontal: 8,
      },
    },
  } as const,

  defaultVariants: {
    tone: 'solid',
  },
});
