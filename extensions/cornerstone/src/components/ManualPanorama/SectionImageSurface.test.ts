import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import SectionImageSurface from './SectionImageSurface';

it('moves image and markers together in screen pixels, consumes hand clicks, and preserves pan when zoom changes', () => {
  const select = jest.fn();
  const content = React.createElement('button', { onClick:select }, 'image and cross');
  const view = render(React.createElement(SectionImageSurface, { zoom:2, enabled:false }, content));
  fireEvent.click(view.getByRole('button'));
  expect(select).toHaveBeenCalledTimes(1);
  view.rerender(React.createElement(SectionImageSurface, { zoom:2, enabled:true }, content));
  const surface = view.getByLabelText('Область изображения поперечного сечения');
  const pointer = (type, x, y) => {
    const event = new MouseEvent(type, { bubbles:true, cancelable:true, button:0, clientX:x, clientY:y });
    Object.defineProperty(event, 'pointerId', { value:1 });
    fireEvent(surface, event);
  };
  pointer('pointerdown',100,100); pointer('pointermove',140,120); pointer('pointerup',140,120);
  expect(view.container.querySelector('.manual-section-raster').getAttribute('style')).toContain('translate(40px, 20px) scale(2)');
  fireEvent.click(view.getByRole('button'));
  expect(select).toHaveBeenCalledTimes(1);
  view.rerender(React.createElement(SectionImageSurface, { zoom:1, enabled:false }, content));
  expect(view.container.querySelector('.manual-section-raster').getAttribute('style')).toContain('translate(40px, 20px) scale(1)');
  pointer('pointermove',180,150);
  expect(view.container.querySelector('.manual-section-raster').getAttribute('style')).toContain('translate(40px, 20px)');
  fireEvent.click(view.getByRole('button'));
  expect(select).toHaveBeenCalledTimes(2);
});
