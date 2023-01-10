import { Pressable } from 'react-native';
import { styled } from 'dank-style';

export default styled(
  Pressable,
  {
    baseStyle: {
      style: {
        position: 'absolute',
        left: '0',
        top: '0',
        opacity: 0.1,
        right: '0',
        bottom: '0',
        bg: '$black',
      },
    },
  },
  {}
);
