import React from 'react';
import { Composition } from 'remotion';
import { Hello } from './Hello';

// 9:16, 3 s ở 30 khung/s. Mọi chuyển động chỉ phụ thuộc useCurrentFrame() → dựng lại ra y hệt.
export const Root: React.FC = () => (
  <Composition id="Main" component={Hello} durationInFrames={90} fps={30} width={1080} height={1920} defaultProps={{ title: 'Xin chào Remotion', sub: 'es-render · rm.mjs' }} />
);
